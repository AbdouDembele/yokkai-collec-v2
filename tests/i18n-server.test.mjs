import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadLocaleModule } from "./helpers/i18n.mjs";
function preference(cookie, profile = "fr", connected = true) {
  const calls = { clients: 0, claims: 0, rpc: 0 };
  const context = {
    exports: {},
    AbortSignal,
    process: { env: {} },
    require(name) {
      if (name === "server-only") return {};
      if (name === "react") return { cache: fn => fn };
      if (name === "./locale")
        return loadLocaleModule({ NEXT_PUBLIC_I18N_ENABLED: "true" });
      if (name === "next/headers")
        return {
          cookies: async () => ({
            get: key =>
              key === "yokkai_locale" && cookie ? { value: cookie } : undefined
          }),
          headers: async () => new Headers({ "accept-language": "en-US" })
        };
      if (name === "@/utils/supabase/server")
        return {
          createClient: () => {
            calls.clients++;
            return {
              auth: {
                getClaims: async () => {
                  calls.claims++;
                  return {
                    data: connected
                      ? { claims: { sub: "connected-user" } }
                      : null
                  };
                }
              },
              rpc: name => {
                assert.equal(name, "get_my_locale");
                calls.rpc++;
                return {
                  abortSignal: async () => ({ data: profile, error: null })
                };
              }
            };
          }
        };
      throw Error(name);
    }
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("i18n/server.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    context
  );
  return { calls, render: context.exports.getLocalePreference };
}
test("connected renders with a valid locale cookie make no locale RPC or Auth request", async () => {
  for (const cookie of [
    "v1:manual:en:seen",
    "v1:manual:fr:seen",
    "v1:auto:fr:new"
  ]) {
    const page = preference(cookie, "fr");
    const value = await page.render();
    assert.equal(value.locale, cookie.split(":")[2]);
    assert.deepEqual(page.calls, { clients: 0, claims: 0, rpc: 0 });
  }
});
test("only connected renders without a valid cookie recover the profile", async () => {
  for (const cookie of [undefined, "bad-cookie"]) {
    const page = preference(cookie);
    assert.equal((await page.render()).locale, "fr");
    assert.equal(page.calls.rpc, 1);
  }
  const visitor = preference(undefined, "fr", false);
  assert.equal((await visitor.render()).locale, "en");
  assert.equal(visitor.calls.rpc, 0);
});
