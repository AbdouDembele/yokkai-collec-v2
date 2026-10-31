import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadDisposableEmail } from "./helpers/disposable-email.mjs";
const english = JSON.parse(readFileSync("messages/en.json", "utf8"));
const french = JSON.parse(readFileSync("messages/fr.json", "utf8"));
function fixture() {
  const calls = { clients: 0, signup: [], signin: [], warnings: [] };
  const disposable = loadDisposableEmail();
  const imports = {
    "@/messages/en.json": { default: english, __esModule: true },
    "@/lib/server/disposable-email": disposable,
    "@/i18n/server": { syncProfileLocale: async () => {} },
    "next/headers": { cookies: async () => ({}) },
    "next/cache": { revalidatePath: () => {} },
    "next/navigation": { redirect: () => assert.fail("Unexpected redirect") },
    "@/utils/supabase/server": {
      createClient() {
        calls.clients++;
        return {
          rpc: async () => ({ data: true, error: null }),
          auth: {
            signUp: async input => {
              calls.signup.push(input);
              return { data: { session: null }, error: null };
            },
            signInWithPassword: async input => {
              calls.signin.push(input);
              return { error: { code: "invalid_credentials", status: 400 } };
            }
          }
        };
      }
    }
  };
  function load(file) {
    const exports = {};
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText;
    vm.runInNewContext(code, {
      exports,
      URL,
      process: {
        env: {
          NODE_ENV: "production",
          NEXT_PUBLIC_SITE_URL: "https://example.test"
        }
      },
      console: {
        warn: (...args) => calls.warnings.push(args),
        error: () => {}
      },
      require: name => {
        if (name in imports) return imports[name];
        throw new Error("Unexpected import " + name);
      }
    });
    return exports;
  }
  imports["@/lib/auth/forms"] = load("lib/auth/forms.ts");
  const api = load("app/auth/actions.ts");
  function form(email) {
    const data = new FormData();
    for (const [k, v] of Object.entries({
      email,
      password: "  private-password123  ",
      pseudo: "DomainProof",
      acceptedPolicies: imports["@/lib/auth/forms"].SIGNUP_POLICY_VERSION
    }))
      data.set(k, v);
    return data;
  }
  return { api, form, calls, load };
}
test("real signup Server Action rejects disposable email before any Supabase call and logs only its domain", async () => {
  const { api, form, calls, load } = fixture();
  const result = await api.signUp({}, form(" PrivateUser@Sub.Yopmail.com "));
  assert.equal(result.fields.email, english.authErrors.disposableEmail);
  assert.equal(calls.clients, 0);
  assert.equal(calls.signup.length, 0);
  assert.equal(calls.warnings.length, 1);
  assert.equal(calls.warnings[0][0], "signup_rejected_disposable_email");
  assert.equal(calls.warnings[0][1].domain, "yopmail.com");
  const serialized = JSON.stringify(calls.warnings);
  assert.doesNotMatch(serialized, /PrivateUser|@|private-password123|token/i);
  assert.equal(
    load("i18n/auth-messages.ts").authMessageKey(result.fields.email),
    "disposableEmail"
  );
  assert.match(french.authErrors.disposableEmail, /adresse e-mail permanente/);
});
test("legitimate signup credentials and existing disposable-address login keep their existing flow", async () => {
  for (const domain of [
    "gmail.com",
    "outlook.com",
    "icloud.com",
    "proton.me"
  ]) {
    const { api, form, calls } = fixture();
    const result = await api.signUp({}, form("collector@" + domain));
    assert.equal(result.success, true);
    assert.equal(calls.signup.length, 1);
    assert.equal(calls.signup[0].email, "collector@" + domain);
    assert.equal(calls.signup[0].password, "  private-password123  ");
    assert.equal(
      calls.signup[0].options.emailRedirectTo,
      "https://example.test/auth/confirm"
    );
    assert.equal(calls.warnings.length, 0);
  }
  const { api, form, calls } = fixture();
  await api.signIn({}, form("legacy@yopmail.com"));
  assert.equal(calls.signin.length, 1);
  assert.equal(calls.signin[0].email, "legacy@yopmail.com");
  assert.equal(calls.warnings.length, 0);
});
