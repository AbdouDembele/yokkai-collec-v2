import { loadLocaleProxy } from "./helpers/locale-proxy.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { NextRequest, NextResponse } from "next/server.js";
import ts from "typescript";
import { loadLocaleModule } from "./helpers/i18n.mjs";

function loadProxy(
  getClaims,
  { enabled = false, locale = null, rpcError = null, onRpc = () => {} } = {}
) {
  const source = ts.transpileModule(
    readFileSync(
      new URL("../utils/supabase/proxy.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText;
  const context = {
    exports: {},
    Headers,
    AbortSignal,
    require(name) {
      if (name === "@/i18n/locale")
        return loadLocaleModule({
          NODE_ENV: "production",
          NEXT_PUBLIC_I18N_ENABLED: String(enabled)
        });
      if (name === "next/server") return { NextResponse };
      if (name === "@/utils/supabase/auth-fetch")
        return { serverAuthFetch: () => fetch };
      if (name === "@/utils/supabase/config") {
        return {
          getSupabaseConfig: () => ({
            url: "https://example.supabase.co",
            key: "test-key"
          })
        };
      }
      if (name === "@supabase/ssr") {
        return {
          createServerClient: (_url, _key, { cookies }) => ({
            rpc: () => {
              onRpc();
              return {
                abortSignal: async () => ({ data: locale, error: rpcError })
              };
            },
            auth: { getClaims: () => getClaims(cookies) }
          })
        };
      }
      throw new Error(`Unexpected import: ${name}`);
    }
  };
  vm.runInNewContext(source, context);
  return context.exports.updateSession;
}

test("API polling and generated image requests retain Auth checks without locale RPCs", async () => {
  for (const path of [
    "/api/billing/status",
    "/opengraph-image",
    "/signup/twitter-image"
  ]) {
    let claims = 0;
    let localeReads = 0;
    const updateSession = loadProxy(
      async () => {
        claims++;
        return { data: { claims: { sub: "own-user" } }, error: null };
      },
      { enabled: true, locale: "fr", onRpc: () => localeReads++ }
    );
    await updateSession(new NextRequest("https://yokkai.example" + path));
    assert.equal(claims, 1, path);
    assert.equal(localeReads, 0, path);
  }
});

test("le proxy vérifie la session et laisse passer un visiteur sans cookie", async () => {
  let checked = false;
  const updateSession = loadProxy(async cookies => {
    assert.equal(cookies.getAll().length, 0);
    checked = true;
    return { data: null, error: null };
  });
  const response = await updateSession(new NextRequest("http://localhost/"));
  assert.equal(checked, true);
  assert.equal(response.status, 200);
  assert.equal(response.cookies.getAll().length, 0);
});

test("missing locale cookie recovers the profile without losing refreshed Auth cookies or cache headers", async () => {
  for (const [locale, rpcError, expected] of [
    ["fr", null, "v1:manual:fr:seen"],
    [null, null, "v1:auto:en:new"],
    [null, { code: "PGRST202" }, "v1:auto:en:new"]
  ]) {
    const request = new NextRequest("https://yokkai.example/", {
      headers: { cookie: "session=expired" }
    });
    const updateSession = loadProxy(
      async cookies => {
        cookies.setAll(
          [
            {
              name: "session",
              value: "refreshed",
              options: { httpOnly: true, secure: true }
            }
          ],
          { "Cache-Control": "private, no-store", Expires: "0" }
        );
        return { data: { claims: { sub: "own-user" } }, error: null };
      },
      { enabled: true, locale, rpcError }
    );
    const recoverPreference = loadLocaleProxy(updateSession, {
      locale,
      rpcError
    });
    const response = await recoverPreference(request);
    assert.equal(request.cookies.get("yokkai_locale").value, expected);
    assert.match(
      response.headers.get("x-middleware-request-cookie"),
      /session=refreshed/
    );
    assert.equal(response.cookies.get("session").value, "refreshed");
    assert.equal(response.cookies.get("session").httpOnly, true);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Expires"), "0");
    if (locale === "fr") {
      assert.equal(response.cookies.get("yokkai_locale").value, expected);
      assert.equal(response.cookies.get("yokkai_locale").httpOnly, true);
      assert.equal(response.cookies.get("yokkai_locale").maxAge, 31536000);
    }
  }
});

test("le renouvellement propage les cookies au rendu et au navigateur sans perdre les en-têtes", async () => {
  const request = new NextRequest("http://localhost/collection", {
    headers: { cookie: "session=expired; old-chunk=obsolete" }
  });
  const updateSession = loadProxy(async cookies => {
    assert.equal(
      cookies.getAll().find(({ name }) => name === "session").value,
      "expired"
    );
    cookies.setAll(
      [
        {
          name: "session",
          value: "refreshed",
          options: { path: "/", sameSite: "lax", secure: true }
        }
      ],
      {
        "Cache-Control":
          "private, no-cache, no-store, must-revalidate, max-age=0",
        Expires: "0",
        Pragma: "no-cache"
      }
    );
    // Supabase only delivers cache headers on the first write of a request.
    cookies.setAll(
      [{ name: "old-chunk", value: "", options: { path: "/", maxAge: 0 } }],
      {}
    );
    return { data: { claims: { sub: "user-id" } }, error: null };
  });
  const response = await updateSession(request);
  assert.equal(request.cookies.get("session").value, "refreshed");
  assert.match(
    response.headers.get("x-middleware-request-cookie"),
    /session=refreshed/
  );
  assert.equal(response.cookies.get("session").value, "refreshed");
  assert.equal(response.cookies.get("session").secure, true);
  assert.equal(response.cookies.get("session").sameSite, "lax");
  assert.equal(response.cookies.get("old-chunk").maxAge, 0);
  assert.match(response.headers.get("Cache-Control"), /private.*no-store/);
  assert.equal(response.headers.get("Expires"), "0");
  assert.equal(response.headers.get("Pragma"), "no-cache");
});

test("a connected request with a valid cookie performs no locale RPC in either proxy", async () => {
  let localeReads = 0;
  const session = loadProxy(
    async () => ({ data: { claims: { sub: "own-user" } }, error: null }),
    { enabled: true, locale: "fr", onRpc: () => localeReads++ }
  );
  const root = loadLocaleProxy(session, {
    locale: "fr",
    onRpc: () => localeReads++
  });
  const request = new NextRequest("https://yokkai.example/", {
    headers: { cookie: "session=valid; yokkai_locale=v1:manual:en:seen" }
  });
  const response = await root(request);
  assert.equal(localeReads, 0);
  assert.equal(request.cookies.get("yokkai_locale").value, "v1:manual:en:seen");
  assert.equal(
    response.cookies.get("yokkai_locale").value,
    "v1:manual:en:seen"
  );
});
