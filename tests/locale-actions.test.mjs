import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
import { loadLocaleModule } from "./helpers/i18n.mjs";

function actions({
  enabled = true,
  user = null,
  rpcError = null,
  cookie = "v1:auto:en:new",
  language = "fr-FR"
} = {}) {
  const writes = [];
  const values = new Map([["yokkai_locale", cookie]]);
  const store = {
    get: name => (values.has(name) ? { value: values.get(name) } : undefined),
    set(name, value, options) {
      writes.push({ kind: "cookie", name, value, options });
      values.set(name, value);
    }
  };
  const client = {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name, args) => {
      writes.push({ kind: "rpc", name, args });
      return { error: rpcError };
    }
  };
  const context = {
    exports: {},
    require(name) {
      if (name === "next/headers")
        return {
          cookies: async () => store,
          headers: async () => new Headers({ "accept-language": language })
        };
      if (name === "@/utils/supabase/server")
        return { createClient: () => client };
      if (name === "@/i18n/locale")
        return loadLocaleModule({
          NODE_ENV: "production",
          NEXT_PUBLIC_I18N_ENABLED: String(enabled)
        });
      throw new Error(name);
    },
    process: { env: {} }
  };
  const code = ts.transpileModule(
    readFileSync("app/locale-actions.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  vm.runInNewContext(code, context);
  return { ...context.exports, writes, values };
}

test("anonymous choice writes a one-year cookie, automatic redetects, invalid/off writes nothing", async () => {
  const api = actions();
  assert.equal((await api.setLocalePreference("fr")).ok, true);
  assert.equal(api.writes.length, 1);
  const saved = api.writes[0];
  assert.equal(saved.value, "v1:manual:fr:seen");
  assert.equal(saved.options.maxAge, 31536000);
  assert.equal(saved.options.httpOnly, true);
  assert.equal(saved.options.secure, true);
  assert.equal(saved.options.sameSite, "lax");
  assert.equal(saved.options.path, "/");
  assert.equal("domain" in saved.options, false);
  await api.setLocalePreference("auto");
  assert.equal(api.values.get("yokkai_locale"), "v1:auto:fr:seen");
  for (const invalid of ["de", "../fr", "", null]) {
    const invalidApi = actions();
    assert.equal((await invalidApi.setLocalePreference(invalid)).ok, false);
    assert.equal(invalidApi.writes.length, 0);
  }
  const disabled = actions({ enabled: false });
  assert.equal((await disabled.setLocalePreference("fr")).ok, false);
  assert.equal(disabled.writes.length, 0);
});

test("explicit connected choice updates only the caller RPC before the cookie; failure preserves the cookie", async () => {
  const api = actions({ user: { id: "own-user" } });
  assert.equal((await api.setLocalePreference("fr")).ok, true);
  assert.equal(api.writes[0].kind, "rpc");
  assert.equal(api.writes[0].name, "set_my_locale");
  assert.equal(api.writes[0].args.p_locale, "fr");
  assert.equal(Object.keys(api.writes[0].args).length, 1);
  assert.equal(api.writes[1].kind, "cookie");
  await api.setLocalePreference("auto");
  assert.equal(api.writes[2].args.p_locale, null);
  const failure = actions({
    user: { id: "own-user" },
    rpcError: { code: "PGRST202" }
  });
  assert.equal((await failure.setLocalePreference("fr")).ok, false);
  assert.equal(failure.values.get("yokkai_locale"), "v1:auto:en:new");
  assert.equal(failure.writes.length, 1);
});

test("closing the detection banner only updates the cookie", async () => {
  const api = actions({ cookie: "v1:auto:fr:new", user: { id: "own-user" } });
  await api.dismissLocaleBanner();
  assert.equal(api.writes.length, 1);
  assert.equal(api.writes[0].kind, "cookie");
  assert.equal(api.values.get("yokkai_locale"), "v1:auto:fr:seen");
});
