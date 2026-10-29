import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import { intl, loadLocaleModule } from "./helpers/i18n.mjs";

function harness({ denied = false, refresh = false, failLocale = false } = {}) {
  const counts = { clients: 0, claims: 0, locales: [] };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    const context = {
      exports,
      Headers,
      Response,
      AbortSignal,
      process: {
        env: { NODE_ENV: "production", NEXT_PUBLIC_I18N_ENABLED: "true" }
      },
      require(name) {
        if (name === "next/server") return { NextResponse };
        if (name === "next-intl") return intl;
        if (name === "@/i18n/locale")
          return loadLocaleModule(context.process.env);
        if (name === "@/utils/supabase/proxy")
          return load("utils/supabase/proxy.ts");
        if (name === "@/utils/supabase/config")
          return {
            getSupabaseConfig: () => ({
              url: "https://api.example.test",
              key: "public-test-key"
            })
          };
        if (name === "@/utils/supabase/auth-fetch")
          return { serverAuthFetch: () => fetch };
        if (name.startsWith("@/messages/"))
          return {
            default: JSON.parse(readFileSync(name.replace("@/", ""), "utf8"))
          };
        if (name === "@supabase/ssr")
          return {
            createServerClient(_url, _key, { cookies }) {
              counts.clients++;
              let verified = false;
              const user = cookies
                .getAll()
                .find(c => c.name === "session")?.value;
              return {
                auth: {
                  async getClaims() {
                    counts.claims++;
                    await Promise.resolve();
                    if (refresh)
                      cookies.setAll(
                        [
                          {
                            name: "session",
                            value: "renewed",
                            options: { httpOnly: true, secure: true }
                          }
                        ],
                        { "Cache-Control": "private, no-store", Expires: "0" }
                      );
                    verified = !denied && Boolean(user);
                    return {
                      data: {
                        claims: verified
                          ? { sub: user, app_metadata: { provider: "email" } }
                          : null
                      }
                    };
                  }
                },
                rpc(name) {
                  assert.equal(name, "get_my_locale");
                  assert.equal(
                    verified,
                    true,
                    "locale lookup must use this client's verified session"
                  );
                  counts.locales.push(user);
                  return {
                    abortSignal: async () => ({
                      data: user === "french-user" ? "fr" : "en",
                      error: failLocale ? { code: "OFFLINE" } : null
                    })
                  };
                }
              };
            }
          };
        throw Error(name);
      }
    };
    vm.runInNewContext(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }).outputText,
      context
    );
    modules.set(file, exports);
    return exports;
  }
  return { proxy: load("proxy.ts").proxy, counts };
}
const request = (user = "french-user", path = "/", locale = "") =>
  new NextRequest("https://example.test" + path, {
    headers: {
      cookie: `session=${user}${locale ? "; yokkai_locale=" + locale : ""}`,
      "x-verified-user": "forged",
      "x-authenticated": "true"
    }
  });

test("missing locale reuses one verified client without losing refresh cookies or private cache headers", async () => {
  const { proxy, counts } = harness({ refresh: true });
  const req = request();
  const res = await proxy(req);
  assert.equal(counts.clients, 1);
  assert.equal(counts.claims, 1);
  assert.deepEqual(counts.locales, ["french-user"]);
  assert.equal(req.cookies.get("yokkai_locale").value, "v1:manual:fr:seen");
  assert.equal(res.cookies.get("session").value, "renewed");
  assert.equal(res.cookies.get("session").httpOnly, true);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.equal(res.headers.get("Expires"), "0");
  assert.match(
    res.headers.get("x-middleware-request-cookie"),
    /session=renewed/
  );
});

test("rejected identities and forged headers cannot trigger locale reads", async () => {
  const { proxy, counts } = harness({ denied: true });
  const res = await proxy(request());
  assert.equal(counts.claims, 1);
  assert.equal(counts.clients, 1);
  assert.deepEqual(counts.locales, []);
  assert.equal(res.cookies.get("yokkai_locale").value, "v1:auto:en:new");
});

test("concurrent independent requests verify each identity and never share a client or claims", async () => {
  const { proxy, counts } = harness();
  const [fr, en] = await Promise.all([
    proxy(request()),
    proxy(request("english-user"))
  ]);
  assert.equal(counts.claims, 2);
  assert.equal(counts.clients, 2);
  assert.deepEqual(counts.locales.sort(), ["english-user", "french-user"]);
  assert.equal(fr.cookies.get("yokkai_locale").value, "v1:manual:fr:seen");
  assert.equal(en.cookies.get("yokkai_locale").value, "v1:manual:en:seen");
});

test("saved preferences and API requests retain verification without locale RPCs", async () => {
  for (const [path, locale] of [
    ["/catalog", "v1:manual:fr:seen"],
    ["/api/pro/benefits", ""],
    ["/api/pro/profile-style", ""]
  ]) {
    const { proxy, counts } = harness();
    await proxy(request("french-user", path, locale));
    assert.equal(counts.claims, 1, path);
    assert.deepEqual(counts.locales, [], path);
  }
});

test("public shares still verify for preference recovery and failed locale reads retain fallback", async () => {
  for (const [path, failLocale, expected] of [
    ["/share/" + "a".repeat(32), false, "v1:manual:fr:seen"],
    ["/", true, "v1:auto:en:new"]
  ]) {
    const { proxy, counts } = harness({ failLocale });
    const res = await proxy(request("french-user", path));
    assert.equal(counts.claims, 1);
    assert.equal(counts.clients, 1);
    assert.equal(res.cookies.get("yokkai_locale").value, expected);
  }
});
