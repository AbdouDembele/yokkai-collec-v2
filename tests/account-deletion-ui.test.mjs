import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, imports = {}, env = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    { exports, Date, URL, process: { env }, require: name => imports[name] }
  );
  return exports;
}

test("recent authentication requires a verified primary login timestamp, never token issuance", () => {
  const { hasRecentAuthentication } = load("lib/auth/recent-auth.ts");
  const now = 2000000000;
  assert.equal(hasRecentAuthentication({ auth_time: now - 300 }, now), true);
  for (const method of ["password", "magiclink", "otp", "oauth"]) {
    assert.equal(
      hasRecentAuthentication({ amr: [{ method, timestamp: now - 10 }] }, now),
      true
    );
  }
  for (const claims of [
    {},
    { iat: now },
    { auth_time: now - 301 },
    { auth_time: now + 1 },
    { auth_time: "2000000000" },
    { auth_time: null },
    { auth_time: now - 301, amr: [{ method: "password", timestamp: now }] },
    { amr: [{ method: "token_refresh", timestamp: now }] },
    {
      amr: [
        { method: "password", timestamp: now - 301 },
        { method: "token_refresh", timestamp: now }
      ]
    },
    { amr: [{ method: "oauth", timestamp: now + 1 }] },
    { amr: [{ method: "otp", timestamp: "2000000000" }] },
    { amr: [{ method: "anonymous", timestamp: now }] },
    { user_metadata: { auth_time: now } }
  ])
    assert.equal(
      hasRecentAuthentication(claims, now),
      false,
      JSON.stringify(claims)
    );
});

function actionHarness({
  claims,
  claimsError,
  userError,
  pseudo = "EraseMe",
  rpcError,
  deletionError,
  signOutError,
  contactEmail
} = {}) {
  const calls = [];
  const id = "10000000-0000-4000-8000-000000000001";
  const client = {
    auth: {
      getClaims: async () => {
        calls.push("verify");
        return {
          data: {
            claims: claims ?? {
              sub: id,
              role: "authenticated",
              auth_time: Math.floor(Date.now() / 1000)
            }
          },
          error: claimsError
        };
      },
      getUser: async () => {
        calls.push("user");
        return { data: { user: userError ? null : { id } }, error: userError };
      },
      signOut: async options => {
        calls.push(["signOut", options]);
        return { error: signOutError };
      }
    },
    rpc: async name => {
      calls.push(name);
      return { data: { user: { name: pseudo } }, error: rpcError };
    }
  };
  const { deleteAccountAction, reconnectForDeletion } = load(
    "app/settings/actions.ts",
    {
      "next/headers": {
        cookies: async () => ({
          getAll: () => [
            { name: "sb-example-auth-token" },
            { name: "sb-example-auth-token.0" },
            { name: "unrelated" }
          ],
          delete: name => calls.push(["cookie", name])
        })
      },
      "next/navigation": {
        redirect: path => {
          calls.push(["redirect", path]);
          throw new Error(`REDIRECT:${path}`);
        }
      },
      "next/cache": { revalidatePath: () => {} },
      "@/utils/supabase/server": { createClient: () => client },
      "@/utils/supabase/config": {
        getSupabaseConfig: () => ({ url: "https://example.test" })
      },
      "@/lib/auth/recent-auth": load("lib/auth/recent-auth.ts"),
      "@/lib/server/account-deletion": {
        deleteAccount: async uuid => {
          calls.push(["delete", uuid]);
          if (deletionError) throw new Error("PRIVATE_PROVIDER_DETAIL");
        }
      }
    },
    { NEXT_PUBLIC_CONTACT_EMAIL: contactEmail }
  );
  return { calls, deleteAccountAction, reconnectForDeletion, id };
}

test("action verifies JWT and live user, compares own pseudo, deletes, signs out then redirects", async () => {
  const h = actionHarness();
  const form = new FormData();
  form.set("pseudo", "EraseMe");
  form.set("userId", "another-player");
  await assert.rejects(
    h.deleteAccountAction({}, form),
    /REDIRECT:\/account-deleted/
  );
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    "verify",
    "user",
    "get_game_info",
    ["delete", h.id],
    ["signOut", { scope: "local" }],
    ["cookie", "sb-example-auth-token"],
    ["cookie", "sb-example-auth-token.0"],
    ["redirect", "/account-deleted"]
  ]);
});

test("a passwordless OAuth account deletes after a recent provider sign-in, never a stale one", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const now = Math.floor(Date.now() / 1000);
  // GoTrue's OAuth tokens carry no auth_time: only amr records the provider login.
  const oauthClaims = timestamp => ({
    sub: id,
    role: "authenticated",
    app_metadata: { provider: "google", providers: ["google"] },
    amr: [{ method: "oauth", timestamp }]
  });
  const form = new FormData();
  form.set("pseudo", "EraseMe");
  const recent = actionHarness({ claims: oauthClaims(now - 30) });
  await assert.rejects(
    recent.deleteAccountAction({}, form),
    /REDIRECT:\/account-deleted/
  );
  assert.ok(
    recent.calls.some(call => Array.isArray(call) && call[0] === "delete")
  );
  const stale = actionHarness({ claims: oauthClaims(now - 301) });
  const state = await stale.deleteAccountAction({}, form);
  assert.equal(state.reconnect, true);
  assert.ok(
    !stale.calls.some(call => Array.isArray(call) && call[0] === "delete")
  );
});

test("invalid signature, stale/missing authentication, identity mismatch and wrong pseudo cannot delete", async () => {
  for (const options of [
    { claimsError: {} },
    { userError: {} },
    { claims: { iat: Math.floor(Date.now() / 1000) } },
    {
      claims: {
        sub: "other",
        role: "authenticated",
        auth_time: Math.floor(Date.now() / 1000)
      }
    },
    {
      claims: {
        sub: "10000000-0000-4000-8000-000000000001",
        role: "authenticated",
        auth_time: 1
      }
    },
    { pseudo: "SomeoneElse" },
    { rpcError: {} }
  ]) {
    const h = actionHarness(options);
    const form = new FormData();
    form.set("pseudo", "EraseMe");
    const state = await h.deleteAccountAction({}, form);
    assert.ok(state.error);
    assert.ok(!h.calls.some(c => Array.isArray(c) && c[0] === "delete"));
  }
});

test("failure is safe and a logout failure after deletion never repeats deletion", async () => {
  const form = new FormData();
  form.set("pseudo", "EraseMe");
  const failed = actionHarness({ deletionError: true });
  const state = await failed.deleteAccountAction({}, form);
  assert.ok(state.error);
  assert.ok(!state.error.includes("PRIVATE_PROVIDER_DETAIL"));
  assert.ok(!failed.calls.some(c => Array.isArray(c) && c[0] === "redirect"));
  const loggedOut = actionHarness({ signOutError: {} });
  await assert.rejects(
    loggedOut.deleteAccountAction({}, form),
    /REDIRECT:\/account-deleted/
  );
  assert.equal(
    loggedOut.calls.filter(c => Array.isArray(c) && c[0] === "delete").length,
    1
  );
});

test("deletion failure only includes the configured contact email", async () => {
  const form = new FormData();
  form.set("pseudo", "EraseMe");
  const original =
    "We couldn't finish deleting your account. Don't submit another request. Contact the team to check its status.";
  for (const contactEmail of [undefined, "", "   ", " contact@example.test "]) {
    const h = actionHarness({ deletionError: true, contactEmail });
    const state = await h.deleteAccountAction({}, form);
    assert.equal(
      state.error,
      original + (contactEmail?.trim() ? " Contact: contact@example.test." : "")
    );
  }
});

test("reconnection clears only this session before returning to login", async () => {
  const h = actionHarness();
  await assert.rejects(
    h.reconnectForDeletion({}, new FormData()),
    /REDIRECT:\/login/
  );
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    ["signOut", { scope: "local" }],
    ["redirect", "/login"]
  ]);
});
