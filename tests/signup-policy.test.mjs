import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, imports = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const context = {
    exports: {},
    URL,
    ...globals,
    require(name) {
      if (name in imports) return imports[name];
      if (name === "@/messages/en.json")
        return {
          default: JSON.parse(readFileSync("messages/en.json", "utf8")),
          __esModule: true
        };
      if (name === "@/i18n/server")
        return { syncProfileLocale: async () => {} };
      throw new Error(`Unexpected import: ${name}`);
    }
  };
  vm.runInNewContext(code, context);
  return context.exports;
}

const forms = load("lib/auth/forms.ts");
function form() {
  const value = new FormData();
  value.set("pseudo", "Yōkai 43");
  value.set("email", "collector@example.test");
  value.set("password", " test-password ");
  value.set("acceptedPolicies", forms.SIGNUP_POLICY_VERSION);
  return value;
}

function actions() {
  const calls = { clients: 0, availability: 0, signup: [], signin: 0 };
  const api = load(
    "app/auth/actions.ts",
    {
      "next/headers": { cookies: async () => ({}) },
      "next/navigation": { redirect: () => assert.fail("Unexpected redirect") },
      "next/cache": { revalidatePath: () => {} },
      "@/lib/auth/forms": forms,
      "@/utils/supabase/server": {
        createClient() {
          calls.clients++;
          return {
            rpc: async () => {
              calls.availability++;
              return { data: true, error: null };
            },
            auth: {
              signUp: async input => {
                calls.signup.push(input);
                return { data: { session: null }, error: null };
              },
              signInWithPassword: async () => {
                calls.signin++;
                return { error: { code: "invalid_credentials", status: 400 } };
              }
            }
          };
        }
      }
    },
    {
      process: {
        env: {
          NODE_ENV: "production",
          NEXT_PUBLIC_SITE_URL: "https://yokkai.test"
        }
      }
    }
  );
  return { api, calls };
}

test("signup requires exactly one explicit acceptance of the current policy version", async () => {
  assert.equal(forms.SIGNUP_POLICY_VERSION, "2026-10-20");
  for (const values of [
    [],
    [""],
    ["false"],
    ["on"],
    ["outdated-version"],
    [forms.SIGNUP_POLICY_VERSION, forms.SIGNUP_POLICY_VERSION],
    [forms.SIGNUP_POLICY_VERSION, "false"]
  ]) {
    const data = form();
    data.delete("acceptedPolicies");
    for (const value of values) data.append("acceptedPolicies", value);
    const { api, calls } = actions();
    const result = await api.signUp({}, data);
    assert.match(
      result.fields.acceptedPolicies,
      /Accept the Terms of Use and Community rules/
    );
    assert.equal(calls.clients, 0);
    assert.equal(calls.availability, 0);
    assert.equal(calls.signup.length, 0);
    assert.equal("password" in result.values, false);
  }
  const data = form();
  data.set(
    "acceptedPolicies",
    new Blob([forms.SIGNUP_POLICY_VERSION]),
    "policy.txt"
  );
  assert.ok(forms.signupPolicyValidationError(data));
});

test("the server forwards the accepted version and its own time, not a submitted time", async () => {
  const data = form();
  data.set("acceptedAt", "1990-01-01T00:00:00.000Z");
  const { api, calls } = actions();
  const before = Date.now();
  const result = await api.signUp({}, data);
  const after = Date.now();
  assert.equal(result.success, true);
  assert.equal(calls.signup.length, 1);
  const sent = calls.signup[0];
  assert.equal(sent.password, " test-password ");
  assert.equal(sent.options.data.pseudo, "Yōkai 43");
  assert.equal(
    sent.options.data.signup_policies.version,
    forms.SIGNUP_POLICY_VERSION
  );
  const acceptedAt = Date.parse(sent.options.data.signup_policies.accepted_at);
  assert.ok(acceptedAt >= before && acceptedAt <= after);
  assert.equal(
    JSON.stringify(sent.options.data).includes("test-password"),
    false
  );
});

test("all emoji forms are rejected by shared validation, browser pattern, and signup action", async () => {
  const pattern = new RegExp(`^(?:${forms.PSEUDO_NO_EMOJI_PATTERN})$`, "u");
  for (const pseudo of [
    "Yōkai 👺",
    "😀".repeat(30),
    "Player 🇫🇷",
    "Player 👨‍👩‍👧‍👦",
    "Player 👍🏽",
    "Player 1️⃣",
    "Player 1\u20E3",
    "Player ☀",
    "Player 🪼",
    "Player \u{1F3FD}",
    "Player \uFE0F",
    "Player \u{E0067}"
  ]) {
    assert.match(forms.pseudoValidationError(pseudo), /without emoji/);
    assert.equal(pattern.test(pseudo), false, pseudo);
    const data = form();
    data.set("pseudo", pseudo);
    const { api, calls } = actions();
    assert.match((await api.signUp({}, data)).fields.pseudo, /without emoji/);
    assert.equal(calls.clients, 0);
    assert.equal(
      await api.checkPseudoAvailabilityWhileTyping(pseudo),
      undefined
    );
    assert.equal(calls.clients, 0);
  }
});

test("digits, spaces, accents and non-Latin or supplementary letters remain allowed", () => {
  const pattern = new RegExp(`^(?:${forms.PSEUDO_NO_EMOJI_PATTERN})$`, "u");
  for (const pseudo of [
    "Émi",
    "Yōkai 東京",
    "Player 123",
    "e\u0301mi",
    "عبدالله",
    "𐐀".repeat(30)
  ]) {
    assert.equal(forms.pseudoValidationError(pseudo), undefined, pseudo);
    assert.equal(pattern.test(pseudo), true, pseudo);
  }
  assert.match(forms.pseudoValidationError("𐐀".repeat(31)), /no more than 30/);
});

test("sign-in does not require policy acceptance or reject existing emoji usernames", async () => {
  const data = form();
  data.delete("acceptedPolicies");
  data.set("pseudo", "Existing 😀");
  const { api, calls } = actions();
  assert.match(
    (await api.signIn({}, data)).error,
    /Incorrect email or password/
  );
  assert.equal(calls.signin, 1);
  assert.equal(calls.signup.length, 0);
});

test("the checkbox is signup-only, controlled, required, and linked accessibly to both policies", () => {
  const source = readFileSync("components/auth-form.tsx", "utf8");
  assert.match(
    source,
    /\[policiesAccepted, setPoliciesAccepted\] = useState\(false\)/
  );
  assert.match(source, /\{signup && \(\s*<div className="yk-auth-policy">/);
  assert.match(
    source,
    /name="acceptedPolicies"[\s\S]*?type="checkbox"[\s\S]*?required[\s\S]*?checked=\{policiesAccepted\}/
  );
  assert.match(source, /<label htmlFor="accepted-policies">/);
  for (const href of ["terms", "rules"]) {
    assert.match(
      source,
      new RegExp(
        `href="/${href}"\\s+target="_blank"\\s+rel="noopener noreferrer"`
      )
    );
  }
  assert.match(source, /aria-label=\{t\("termsOfUseOpensInANewTab"\)\}/);
  assert.match(source, /aria-label=\{t\("communityRulesOpensInANewTab"\)\}/);
  const english = JSON.parse(readFileSync("messages/en.json", "utf8"));
  const french = JSON.parse(readFileSync("messages/fr.json", "utf8"));
  assert.equal(
    english.authForm.termsOfUseOpensInANewTab,
    "Terms of Use (opens in a new tab)"
  );
  assert.equal(
    english.authForm.communityRulesOpensInANewTab,
    "Community rules (opens in a new tab)"
  );
  assert.equal(
    french.authForm.termsOfUseOpensInANewTab,
    "Conditions d'utilisation (nouvel onglet)"
  );
  assert.equal(
    french.authForm.communityRulesOpensInANewTab,
    "Règles de la communauté (nouvel onglet)"
  );
  assert.match(source, /pattern=\{PSEUDO_NO_EMOJI_PATTERN\}/);
  assert.match(source, /id="pseudo-help"[^>]*>\s*\{t\("text330Characters"\)\}/);
  assert.equal(english.authForm.text330Characters, "3–30 characters.");
  assert.equal(french.authForm.text330Characters, "3 à 30 caractères.");
  assert.doesNotMatch(source, /Spaces between characters|allowed\. No emoji\./);
  assert.doesNotMatch(source, /accents, and emoji/);
  assert.doesNotMatch(
    source,
    /Preview only|awaiting legal review|policy-draft-note/i
  );
});
