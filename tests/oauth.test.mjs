import { englishMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { NextRequest, NextResponse } from "next/server.js";
import ts from "typescript";

function load(file, imports = {}, globals = {}) {
  const context = {
    exports: {},
    URL,
    URLSearchParams,
    Headers,
    ...globals,
    require(name) {
      if (name in imports) return imports[name];
      if (name === "@/messages/en.json") return { default: englishMessages };
      if (name === "@/i18n/server")
        return { syncProfileLocale: async () => {} };
      throw new Error(`Unexpected import: ${name}`);
    }
  };
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
    context
  );
  return context.exports;
}

// Values built inside the vm realm have foreign prototypes.
const same = (actual, expected, message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

const oauth = load("lib/auth/oauth.ts");
const forms = load("lib/auth/forms.ts");
const code = "0123456789ab";

test("next only accepts same-origin paths, never an open redirect", () => {
  for (const [value, expected] of [
    ["/collection", "/collection"],
    ["/market/42?tab=bids#top", "/market/42?tab=bids#top"],
    ["/a/../trades", "/trades"]
  ])
    assert.equal(oauth.safeNextPath(value), expected, value);
  for (const value of [
    undefined,
    null,
    "",
    "collection",
    "https://evil.example/",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
    " /collection"
  ])
    assert.equal(oauth.safeNextPath(value), "/boosters", JSON.stringify(value));
});

function callback(exchange) {
  const calls = [];
  const cookiesSet = [];
  const { GET } = load(
    "app/auth/callback/route.ts",
    {
      "next/headers": {
        cookies: async () => ({
          set: (...args) => cookiesSet.push(args)
        })
      },
      "next/server": { NextResponse },
      "@/utils/supabase/server": {
        createClient: () => ({
          auth: {
            exchangeCodeForSession: async value => {
              calls.push(value);
              return exchange(value);
            }
          }
        })
      },
      "@/lib/auth/oauth": oauth
    },
    { process: { env: { NEXT_PUBLIC_SITE_URL: "https://yokkai.example" } } }
  );
  return {
    calls,
    cookiesSet,
    get: async query => {
      const response = await GET(
        new NextRequest(`http://internal:3000/auth/callback${query}`)
      );
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      return response.headers.get("location");
    }
  };
}

test("callback exchanges the PKCE code, lands a sign-in on home and redirects only to an internal next", async () => {
  const ok = callback(async () => ({ data: { user: null }, error: null }));
  assert.equal(
    await ok.get("?code=abc&next=/collection"),
    "https://yokkai.example/collection"
  );
  assert.equal(
    await ok.get("?code=abc&next=https://evil.example"),
    "https://yokkai.example/"
  );
  assert.equal(
    await ok.get("?code=abc&next=//evil.example"),
    "https://yokkai.example/"
  );
  same(ok.calls, ["abc", "abc", "abc"]);
});

test("callback errors return to sign-in with a stable reason and an English message", async () => {
  const unused = callback(async () => assert.fail("no exchange on error"));
  assert.equal(
    await unused.get("?error=access_denied&error_description=denied"),
    "https://yokkai.example/login?oauth=denied"
  );
  assert.equal(
    await unused.get(
      "?code=abc&error=access_denied&error_code=provider_email_needs_verification"
    ),
    "https://yokkai.example/login?oauth=verify-email"
  );
  assert.equal(
    await unused.get(""),
    "https://yokkai.example/login?oauth=error"
  );
  const invalid = callback(async () => ({
    error: { status: 400, name: "AuthApiError" }
  }));
  assert.equal(
    await invalid.get("?code=bad"),
    "https://yokkai.example/login?oauth=error"
  );
  const down = callback(async () => {
    throw new Error("network");
  });
  assert.equal(
    await down.get("?code=abc"),
    "https://yokkai.example/login?oauth=service"
  );
  for (const reason of ["denied", "verify-email", "service", "error"])
    assert.match(oauth.oauthCallbackMessage(reason), /^[A-Z][^]*\.$/);
  assert.equal(oauth.oauthCallbackMessage("other"), undefined);
});

function proxy(claims, required) {
  const rpcCalls = [];
  const { updateSession } = load("utils/supabase/proxy.ts", {
    "next/server": { NextResponse },
    "@/utils/supabase/auth-fetch": { serverAuthFetch: () => fetch },
    "@/utils/supabase/config": {
      getSupabaseConfig: () => ({
        url: "https://example.supabase.co",
        key: "k"
      })
    },
    "@supabase/ssr": {
      createServerClient: () => ({
        auth: { getClaims: async () => ({ data: { claims }, error: null }) },
        rpc: async name => {
          rpcCalls.push(name);
          return { data: required, error: null };
        }
      })
    }
  });
  return {
    rpcCalls,
    visit: async path =>
      updateSession(new NextRequest(`http://localhost${path}`))
  };
}

test("proxy keeps a new OAuth account on the username step until it is chosen", async () => {
  const pending = proxy(
    { sub: "u", app_metadata: { provider: "google" }, user_metadata: {} },
    true
  );
  for (const path of ["/", "/boosters", "/collection", "/market/1"]) {
    const response = await pending.visit(path);
    assert.equal(response.status, 307, path);
    assert.equal(
      new URL(response.headers.get("location")).pathname,
      "/choose-username"
    );
  }
  for (const path of ["/choose-username", "/auth/callback", "/terms"])
    assert.equal((await pending.visit(path)).status, 200, path);

  const done = proxy(
    { sub: "u", app_metadata: { provider: "discord" }, user_metadata: {} },
    false
  );
  assert.equal((await done.visit("/boosters")).status, 200);

  const chosen = proxy(
    {
      sub: "u",
      app_metadata: { provider: "google" },
      user_metadata: { pseudo: "Hero" }
    },
    true
  );
  assert.equal((await chosen.visit("/boosters")).status, 200);
  const email = proxy(
    { sub: "u", app_metadata: { provider: "email" }, user_metadata: {} },
    true
  );
  assert.equal((await email.visit("/boosters")).status, 200);
  same(
    [...chosen.rpcCalls, ...email.rpcCalls],
    [],
    "chosen usernames and email accounts never query the database"
  );
});

function actions({ settings, signIn, rpc, cookies = {} } = {}) {
  const calls = [];
  const jar = new Map(Object.entries(cookies));
  const cookieStore = {
    get: name => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name, value, options) => {
      jar.set(name, value);
      calls.push(["set", name, value, options]);
    },
    delete: name => {
      jar.delete(name);
      calls.push(["delete", name]);
    }
  };
  const client = {
    auth: {
      signInWithOAuth: async options => {
        calls.push(["oauth", options]);
        return (
          signIn ?? {
            data: { url: "https://api.example/auth/v1/authorize?x" },
            error: null
          }
        );
      },
      updateUser: async options => {
        calls.push(["updateUser", options]);
        return { error: null };
      },
      refreshSession: async () => {
        calls.push(["refresh"]);
        return { error: null };
      }
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      return rpc ?? { data: null, error: null };
    }
  };
  const loaded = load(
    "app/auth/oauth-actions.ts",
    {
      "next/headers": { cookies: async () => cookieStore },
      "next/navigation": {
        redirect: path => {
          throw new Error(`REDIRECT:${path}`);
        }
      },
      "next/cache": { revalidatePath: () => {} },
      "@/utils/supabase/server": { createClient: () => client },
      "@/utils/supabase/config": {
        getSupabaseConfig: () => ({ url: "https://api.example", key: "pub" })
      },
      "@/utils/supabase/auth-fetch": {
        serverAuthFetch: () => async (url, init) => {
          calls.push(["settings", url, init.headers.apikey]);
          return (
            settings ?? {
              ok: true,
              json: async () => ({ external: { google: true, discord: true } })
            }
          );
        }
      },
      "@/lib/auth/forms": forms,
      "@/lib/auth/oauth": oauth
    },
    {
      process: {
        env: {
          NEXT_PUBLIC_SITE_URL: "https://yokkai.example",
          NODE_ENV: "production"
        }
      },
      Date
    }
  );
  return { ...loaded, calls, jar };
}

test("OAuth start uses PKCE redirect to the callback and keeps the referral in a short httpOnly cookie", async () => {
  const h = actions();
  same(await h.startOAuth("google", code.toUpperCase()), {
    url: "https://api.example/auth/v1/authorize?x"
  });
  same(h.calls[0], ["settings", "https://api.example/auth/v1/settings", "pub"]);
  same(h.calls[1], [
    "oauth",
    {
      provider: "google",
      options: {
        redirectTo: "https://yokkai.example/auth/callback",
        skipBrowserRedirect: true
      }
    }
  ]);
  same(h.calls[2], [
    "set",
    oauth.OAUTH_REFERRAL_COOKIE,
    code,
    { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 1800 }
  ]);

  const noReferral = actions({
    cookies: { [oauth.OAUTH_REFERRAL_COOKIE]: code }
  });
  await noReferral.startOAuth("discord", "not-a-code");
  assert.equal(noReferral.jar.has(oauth.OAUTH_REFERRAL_COOKIE), false);
  assert.equal((await actions().startOAuth("github")).url, undefined);
});

test("a provider not enabled in GoTrue gives a clean English message, never a redirect", async () => {
  const h = actions({
    settings: {
      ok: true,
      json: async () => ({ external: { google: false, discord: true } })
    }
  });
  const result = await h.startOAuth("google");
  assert.equal(result.url, undefined);
  assert.equal(
    result.error,
    "Google sign-in isn't available yet. Use your email and password for now."
  );
  assert.equal(
    h.calls.some(([name]) => name === "oauth"),
    false
  );
  const down = await actions({ settings: { ok: false } }).startOAuth("discord");
  assert.match(down.error, /temporarily unavailable/);
});

const usernameForm = (values = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    pseudo: "  OAuthHero ",
    acceptedPolicies: forms.SIGNUP_POLICY_VERSION,
    ...values
  }))
    data.set(key, value);
  return data;
};

test("the username step applies signup rules and attributes the preserved referral", async () => {
  const invalid = actions();
  const state = await invalid.chooseUsername(
    {},
    usernameForm({ pseudo: "ab", acceptedPolicies: "old" })
  );
  assert.equal(state.fields.pseudo, forms.pseudoValidationError("ab"));
  assert.ok(state.fields.acceptedPolicies);
  assert.equal(invalid.calls.length, 0);

  const h = actions({ cookies: { [oauth.OAUTH_REFERRAL_COOKIE]: code } });
  await assert.rejects(
    h.chooseUsername({}, usernameForm()),
    /REDIRECT:\/boosters/
  );
  same(h.calls[0], [
    "choose_pseudo",
    { p_pseudo: "OAuthHero", p_referral_code: code }
  ]);
  assert.equal(h.calls[1][0], "updateUser");
  assert.equal(h.calls[1][1].data.pseudo, "OAuthHero");
  assert.equal(
    h.calls[1][1].data.signup_policies.version,
    forms.SIGNUP_POLICY_VERSION
  );
  same(h.calls[2], ["refresh"]);
  assert.equal(h.jar.has(oauth.OAUTH_REFERRAL_COOKIE), false);

  const taken = actions({
    rpc: { error: { message: "PSEUDO_TAKEN" } }
  });
  assert.equal(
    (await taken.chooseUsername({}, usernameForm())).fields.pseudo,
    "That username is already taken. Try another one."
  );
  const chosen = actions({
    rpc: { error: { message: "PSEUDO_ALREADY_CHOSEN" } }
  });
  await assert.rejects(
    chosen.chooseUsername({}, usernameForm()),
    /REDIRECT:\/boosters/
  );
  const failed = actions({ rpc: { error: { message: "internal detail" } } });
  assert.equal(
    (await failed.chooseUsername({}, usernameForm())).error,
    "We couldn't save your username. Please try again."
  );
});

test("a provider identity just linked to an older account is announced once", async () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const user = (accountAt, identities) => ({
    created_at: accountAt,
    identities: identities.map(([provider, created_at]) => ({
      provider,
      created_at
    }))
  });
  const old = "2026-01-01T00:00:00Z";
  const recent = "2026-10-26T11:58:00Z";
  assert.equal(
    oauth.newlyLinkedProvider(
      user(old, [
        ["email", old],
        ["google", recent]
      ]),
      now
    ),
    "google"
  );
  for (const [label, value] of [
    ["new OAuth account", user(recent, [["discord", recent]])],
    [
      "linked long ago",
      user(old, [
        ["email", old],
        ["google", "2026-10-01T00:00:00Z"]
      ])
    ],
    ["email only", user(old, [["email", recent]])],
    ["no identities", {}]
  ])
    assert.equal(oauth.newlyLinkedProvider(value, now), undefined, label);

  const linked = callback(async () => ({
    data: {
      user: user(old, [
        ["email", old],
        ["discord", new Date().toISOString()]
      ])
    },
    error: null
  }));
  assert.equal(await linked.get("?code=abc"), "https://yokkai.example/");
  same(linked.cookiesSet, [
    [
      oauth.OAUTH_LINKED_COOKIE,
      "discord",
      { sameSite: "lax", path: "/", maxAge: 120 }
    ]
  ]);
});
