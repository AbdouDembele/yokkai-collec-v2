import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import { intl, loadLocaleModule } from "./helpers/i18n.mjs";

function proxy() {
  let sessions = 0;
  const context = {
    exports: {},
    Response,
    process: {
      env: { NEXT_PUBLIC_I18N_ENABLED: "true", NODE_ENV: "production" }
    },
    require(name) {
      if (name === "next/server") return { NextResponse };
      if (name === "next-intl") return intl;
      if (name === "@/i18n/locale")
        return loadLocaleModule({ NEXT_PUBLIC_I18N_ENABLED: "true" });
      if (name.startsWith("@/messages/"))
        return {
          __esModule: true,
          default: JSON.parse(readFileSync(name.replace("@/", ""), "utf8"))
        };
      if (name === "@/utils/supabase/proxy")
        return {
          updateSession: async request => {
            sessions++;
            return NextResponse.next({ request });
          }
        };
      throw new Error(name);
    }
  };
  const code = ts.transpileModule(readFileSync("proxy.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInNewContext(code, context);
  return { run: context.exports.proxy, sessions: () => sessions };
}

test("public share HTML is private per visitor while OG/share images receive no locale cookie or cache override", async () => {
  const api = proxy();
  for (const path of [
    "/opengraph-image",
    "/twitter-image",
    "/signup/opengraph-image",
    "/signup/twitter-image",
    `/share/${"a".repeat(32)}/image/og`
  ]) {
    const response = await api.run(
      new NextRequest("https://yokkai.example" + path, {
        headers: { "accept-language": "fr" }
      })
    );
    assert.equal(response.headers.get("set-cookie"), null, path);
    assert.equal(response.headers.get("cache-control"), null, path);
  }
  assert.equal(
    api.sessions(),
    4,
    "Generated images retain their existing Auth refresh path; share images bypass it"
  );
  for (const language of ["fr", "en", "fr"]) {
    const response = await api.run(
      new NextRequest(`https://yokkai.example/share/${"a".repeat(32)}`, {
        headers: { "accept-language": language }
      })
    );
    assert.equal(
      response.cookies.get("yokkai_locale").value,
      `v1:auto:${language}:new`
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(
      response.headers.get("x-middleware-request-cookie"),
      new RegExp(`yokkai_locale=v1%3Aauto%3A${language}`)
    );
  }
  assert.equal(api.sessions(), 4);
});

test("image bypass cannot bypass the production design-system guard", async () => {
  const api = proxy();
  const response = await api.run(
    new NextRequest("https://yokkai.example/design-system/opengraph-image")
  );
  assert.equal(response.status, 404);
  assert.equal(api.sessions(), 0);
});
