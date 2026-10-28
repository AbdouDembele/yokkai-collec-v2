import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { intl } from "./helpers/i18n.mjs";
import { NextRequest, NextResponse } from "next/server.js";

function loadModule(path, imports = {}, globals = {}) {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  const context = {
    exports: {},
    URL,
    ...globals,
    require(name) {
      if (name === "next-intl") return intl;
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

const forms = loadModule("../lib/auth/forms.ts");
const form = (values = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    email: "joueur@example.com",
    password: "  secret123  ",
    pseudo: "  Yokkai  ",
    acceptedPolicies: "2026-10-20",
    ...values
  })) {
    data.set(key, value);
  }
  return data;
};

function actions(
  auth,
  env = {
    NEXT_PUBLIC_SITE_URL: "https://yokkai.example",
    NODE_ENV: "production"
  }
) {
  const revalidated = [];
  const loaded = loadModule(
    "../app/auth/actions.ts",
    {
      "next/headers": { cookies: async () => ({}) },
      "next/navigation": {
        redirect: path => {
          throw new Error(`REDIRECT:${path}`);
        }
      },
      "next/cache": { revalidatePath: (...args) => revalidated.push(args) },
      "@/utils/supabase/server": {
        createClient: () => ({
          auth,
          rpc: auth.rpc ?? (async () => ({ data: true, error: null }))
        })
      },
      "@/lib/auth/forms": forms,
      ...(auth.dns ? { "node:dns/promises": auth.dns } : {})
    },
    { process: { env } }
  );
  return { ...loaded, revalidated };
}

test("dÃ©veloppement : l'inscription journalise le diagnostic Auth sans donnÃ©es personnelles", async () => {
  const calls = [];
  const loaded = loadModule(
    "../app/auth/actions.ts",
    {
      "next/headers": { cookies: async () => ({}) },
      "next/navigation": {
        redirect: path => {
          throw new Error(`REDIRECT:${path}`);
        }
      },
      "next/cache": { revalidatePath: () => {} },
      "@/utils/supabase/server": {
        createClient: () => ({
          auth: {
            signUp: async () => ({
              data: { user: null, session: null },
              error: Object.assign(
                new Error("Database error for joueur@example.com"),
                { code: "unexpected_failure", status: 500 }
              )
            })
          },
          rpc: async () => ({ data: true, error: null })
        })
      },
      "@/lib/auth/forms": forms
    },
    {
      process: {
        env: {
          NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
          NODE_ENV: "development"
        }
      },
      console: { error: (...args) => calls.push(args) }
    }
  );
  const result = await loaded.signUp({}, form());
  assert.match(result.error, /unavailable/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].code, "unexpected_failure");
  assert.equal(calls[0][1].status, 500);
  assert.equal(calls[0][1].message, "Database error for [email redacted]");
  assert.equal(JSON.stringify(calls).includes("joueur@example.com"), false);
  assert.equal(JSON.stringify(calls).includes("secret123"), false);
  assert.equal(JSON.stringify(calls).includes("Yokkai"), false);
});

test("inscription : validation serveur et conservation exacte du mot de passe", async () => {
  const input = forms.validateCredentials(form(), true);
  assert.equal(input.password, "  secret123  ");
  assert.equal(input.pseudo, "Yokkai");
  const result = await actions({}).signUp(
    {},
    form({ pseudo: " ", email: "bad", password: "short" })
  );
  assert.ok(result.fields.email);
  assert.ok(result.fields.password);
  assert.ok(result.fields.pseudo);
  assert.equal("password" in result.values, false);
  assert.equal(
    forms.validateCredentials(form({ password: "old" }), false).valid,
    true
  );
});

test("réinitialisation : validation de l’email et confirmation identique", () => {
  const validPassword = "x".repeat(12);
  assert.match(
    forms.validateEmail(form({ email: "incorrect" })).error,
    /valid email address/
  );
  assert.equal(
    forms.validateEmail(form({ email: "  joueur@example.com " })).email,
    "joueur@example.com"
  );
  assert.equal(
    forms.validateNewPassword(
      form({ password: validPassword, confirmPassword: validPassword })
    ).valid,
    true
  );
  const mismatch = forms.validateNewPassword(
    form({ password: "x".repeat(5), confirmPassword: "y".repeat(5) })
  );
  assert.match(mismatch.fields.password, /8–128/);
  assert.match(mismatch.fields.confirmPassword, /don't match/);
});

test("paramètres : validation du mot de passe actuel et du nouveau", () => {
  const validPassword = "x".repeat(12);
  const missing = forms.validatePasswordChange(
    form({
      currentPassword: "",
      password: validPassword,
      confirmPassword: validPassword
    })
  );
  assert.match(missing.fields.currentPassword, /current password/);
  const identical = forms.validatePasswordChange(
    form({
      currentPassword: validPassword,
      password: validPassword,
      confirmPassword: validPassword
    })
  );
  assert.match(identical.fields.password, /different/);
});

test("réinitialisation : demande non énumérable et retour canonique", async () => {
  let sent;
  const api = actions({
    resetPasswordForEmail: async (email, options) => {
      sent = { email, options };
      return { error: { code: "user_not_found", status: 400 } };
    }
  });
  const result = await api.requestPasswordReset({}, form());
  assert.equal(result.success, true);
  assert.equal(sent.email, "joueur@example.com");
  assert.equal(
    sent.options.redirectTo,
    "https://yokkai.example/auth/confirm?next=/reset-password"
  );
  assert.equal(JSON.stringify(result).includes("user_not_found"), false);
});

test("réinitialisation : changement authentifié, fermeture globale et retour connexion", async () => {
  const validPassword = "x".repeat(12);
  const calls = [];
  const api = actions({
    getUser: async () => ({
      data: { user: { id: "verified-id" } },
      error: null
    }),
    updateUser: async attributes => {
      calls.push(["update", attributes]);
      return { error: null };
    },
    signOut: async options => {
      calls.push(["signout", options]);
      return { error: null };
    }
  });
  await assert.rejects(
    api.updateRecoveredPassword(
      {},
      form({ password: validPassword, confirmPassword: validPassword })
    ),
    /REDIRECT:\/login\?mot-de-passe=modifie/
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "update");
  assert.equal(calls[0][1].password, validPassword);
  assert.equal(calls[1][0], "signout");
  assert.equal(calls[1][1].scope, "global");
  assert.equal(api.revalidated.length, 1);
});

test("paramètres : le mot de passe actuel est revérifié avant modification", async () => {
  const currentPassword = "x".repeat(11);
  const nextPassword = "y".repeat(12);
  const calls = [];
  const api = actions({
    getUser: async () => ({
      data: { user: { id: "verified-id", email: "joueur@example.com" } },
      error: null
    }),
    signInWithPassword: async credentials => {
      calls.push(["verify", credentials]);
      return { data: { user: { id: "verified-id" } }, error: null };
    },
    updateUser: async attributes => {
      calls.push(["update", attributes]);
      return { error: null };
    }
  });
  const result = await api.changePassword(
    {},
    form({
      currentPassword,
      password: nextPassword,
      confirmPassword: nextPassword
    })
  );
  assert.equal(result.success, true);
  assert.equal(calls[0][1].email, "joueur@example.com");
  assert.equal(calls[0][1].password, currentPassword);
  assert.equal(calls[1][1].password, nextPassword);
  assert.equal(api.revalidated.length, 1);
});

test("paramètres : un mauvais mot de passe actuel ne permet aucune modification", async () => {
  let updates = 0;
  const api = actions({
    getUser: async () => ({
      data: { user: { id: "verified-id", email: "joueur@example.com" } },
      error: null
    }),
    signInWithPassword: async () => ({
      data: { user: null },
      error: { code: "invalid_credentials", status: 400 }
    }),
    updateUser: async () => {
      updates += 1;
      return { error: null };
    }
  });
  const result = await api.changePassword(
    {},
    form({
      currentPassword: "x".repeat(11),
      password: "y".repeat(12),
      confirmPassword: "y".repeat(12)
    })
  );
  assert.match(result.fields.currentPassword, /Incorrect/);
  assert.equal(updates, 0);
});

test("inscription : règles du pseudo et comptage Unicode", () => {
  assert.match(
    forms.validateCredentials(form({ pseudo: "ab" }), true).fields.pseudo,
    /at least 3/
  );
  assert.match(
    forms.validateCredentials(form({ pseudo: "a".repeat(31) }), true).fields
      .pseudo,
    /no more than 30 characters/
  );
  for (const pseudo of [
    "a/b",
    "a\\b",
    "a?b",
    "a#b",
    "a%b",
    "a<b",
    "a>b",
    "a\u0007b"
  ]) {
    assert.match(
      forms.validateCredentials(form({ pseudo }), true).fields.pseudo,
      /can't contain/
    );
  }
  for (const pseudo of [" Émi ", "Yōkai 東京", "𐐀".repeat(30)]) {
    assert.equal(
      forms.validateCredentials(form({ pseudo }), true).fields.pseudo,
      undefined
    );
  }
});

test("inscription : pseudo transmis au trigger, confirmation requise sans fausse session", async () => {
  let sent;
  const api = actions({
    signUp: async input => {
      sent = input;
      return { data: { session: null }, error: null };
    }
  });
  const result = await api.signUp({}, form());
  assert.equal(sent.options.data.pseudo, "Yokkai");
  assert.equal(
    sent.options.emailRedirectTo,
    "https://yokkai.example/auth/confirm"
  );
  assert.equal(result.success, true);
  assert.equal(api.revalidated.length, 0);
  assert.equal(JSON.stringify(result).includes("secret123"), false);
});

test("inscription : un pseudo pris est refusé avant tout appel Auth", async () => {
  let authCalls = 0;
  const api = actions({
    rpc: async (name, params) => {
      assert.equal(name, "is_pseudo_available");
      assert.equal(params.p_pseudo, "KITSUNE");
      return { data: false, error: null };
    },
    signUp: async () => {
      authCalls += 1;
    }
  });
  const result = await api.signUp({}, form({ pseudo: "  KITSUNE  " }));
  assert.equal(
    result.fields.pseudo,
    "That username is already taken. Try another one."
  );
  assert.equal(authCalls, 0);
});

test("inscription : la collision arrivée entre la vérification et Auth est reconnue", async () => {
  let checks = 0;
  const api = actions({
    rpc: async () => ({ data: ++checks === 1, error: null }),
    signUp: async () => ({
      data: { user: null, session: null },
      error: {
        code: "unexpected_failure",
        status: 500,
        message: "Database error saving new user"
      }
    })
  });
  const result = await api.signUp({}, form({ pseudo: "Kitsune" }));
  assert.equal(checks, 2);
  assert.equal(
    result.fields.pseudo,
    "That username is already taken. Try another one."
  );
});

test("inscription sans confirmation et connexion : session puis invalidation du rendu", async () => {
  const api = actions({
    signUp: async () => ({
      data: { session: { access_token: "private" } },
      error: null
    }),
    signInWithPassword: async input => {
      assert.equal(input.password, "  secret123  ");
      return { error: null };
    }
  });
  await assert.rejects(api.signUp({}, form()), /REDIRECT:\/boosters$/);
  await assert.rejects(api.signIn({}, form()), /REDIRECT:\/$/);
  assert.equal(api.revalidated.length, 2);
});

test("erreurs Auth : messages anglais, pas de détails techniques ni de mot de passe", async () => {
  for (const code of [
    "invalid_credentials",
    "email_not_confirmed",
    "user_banned",
    "over_request_rate_limit",
    "unexpected_failure"
  ]) {
    const result = await actions({
      signInWithPassword: async () => ({
        error: { code, message: "SECRET PROVIDER DETAILS" }
      })
    }).signIn({}, form());
    assert.ok(result.error);
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
    assert.equal(JSON.stringify(result).includes("secret123"), false);
  }
  const result = await actions({
    signUp: async () => {
      throw new Error("network");
    }
  }).signUp({}, form());
  assert.match(result.error, /unavailable/);
});

test("inscription : chaque erreur Auth identifiable a un message distinct", () => {
  const expected = new Map([
    ["user_banned", /Your account is banned\./],
    ["weak_password", /password is too weak/],
    ["email_exists", /already in use/],
    ["user_already_exists", /already in use/],
    ["over_request_rate_limit", /Too many attempts/],
    ["over_email_send_rate_limit", /Too many attempts/],
    ["email_address_invalid", /is invalid/],
    ["email_address_not_authorized", /can't be used to sign up/],
    ["signup_disabled", /Sign-ups are temporarily disabled/],
    ["email_provider_disabled", /Sign-ups are temporarily disabled/],
    ["unexpected_failure", /temporarily unavailable/],
    ["request_timeout", /temporarily unavailable/]
  ]);
  for (const [code, message] of expected)
    assert.match(forms.authError(code), message);
  assert.match(
    forms.authError("validation_failed", 400),
    /Authentication was declined/
  );
  assert.match(forms.authError(undefined, 0), /temporarily unavailable/);
  assert.match(forms.authError(undefined, 503), /temporarily unavailable/);
});

test("connexion : un incident réseau transitoire est retenté une seule fois", async () => {
  let attempts = 0;
  const api = actions({
    signInWithPassword: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return {
        error: { code: "invalid_credentials", message: "provider details" }
      };
    }
  });
  const result = await api.signIn({}, form());
  assert.equal(attempts, 2);
  assert.match(result.error, /Incorrect/);
});

test("connexion : une erreur Auth levée conserve son code utilisateur", async () => {
  const api = actions({
    signInWithPassword: async () => {
      throw Object.assign(new Error("provider details"), {
        code: "email_not_confirmed"
      });
    }
  });
  const result = await api.signIn({}, form());
  assert.match(result.error, /Confirm your email/);
  assert.equal(JSON.stringify(result).includes("provider details"), false);
});

test("production : aucune inscription avec une URL de retour manquante ou invalide", async () => {
  for (const site of [
    "",
    "http://yokkai.example",
    "javascript:alert(1)",
    "https://user:password@example.com"
  ]) {
    const result = await actions(
      { signUp: () => assert.fail("must not send email") },
      {
        NODE_ENV: "production",
        NEXT_PUBLIC_SITE_URL: site
      }
    ).signUp({}, form());
    assert.ok(result.error);
  }
});

test("déconnexion locale, propagation des erreurs et redirection après succès", async () => {
  const api = actions({
    rpc: async name => {
      assert.equal(name, "mark_offline");
      return { data: null, error: null };
    },
    signOut: async ({ scope }) => {
      assert.equal(scope, "local");
      return { error: null };
    }
  });
  await assert.rejects(api.signOut(), /REDIRECT:\/login/);
  const failed = await actions({
    signOut: async () => ({ error: { message: "network" } })
  }).signOut();
  assert.match(failed.error, /Couldn't sign out/);
});

function confirm(auth, env = {}) {
  return loadModule(
    "../app/auth/confirm/route.ts",
    {
      "next/headers": { cookies: async () => ({}) },
      "next/server": { NextResponse },
      "@/utils/supabase/server": { createClient: () => ({ auth }) }
    },
    { process: { env } }
  ).GET;
}

test("confirmation : code PKCE et token email, redirection interne sans tokens et sans cache", async () => {
  const handler = confirm({
    exchangeCodeForSession: async code => {
      assert.equal(code, "valid");
      return { error: null };
    },
    verifyOtp: async input => {
      assert.equal(input.token_hash, "hash");
      assert.equal(input.type, "email");
      return { error: null };
    }
  });
  for (const query of ["code=valid", "token_hash=hash&type=email"]) {
    const response = await handler(
      new NextRequest(
        `https://yokkai.example/auth/confirm?${query}&next=https://evil.example`
      )
    );
    assert.equal(response.headers.get("location"), "https://yokkai.example/");
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
});

test("confirmation : lien absent, expiré ou refusé", async () => {
  const invalid = confirm({});
  for (const query of ["", "error=access_denied&code=ignored"]) {
    const response = await invalid(
      new NextRequest(`https://yokkai.example/auth/confirm?${query}`)
    );
    assert.equal(
      response.headers.get("location"),
      "https://yokkai.example/login?confirmation=erreur"
    );
  }
  const expired = await confirm({
    exchangeCodeForSession: async () => ({ error: { message: "expired" } })
  })(new NextRequest("https://yokkai.example/auth/confirm?code=expired"));
  assert.match(expired.headers.get("location"), /confirmation=erreur$/);
});

test("confirmation d'inscription : le nouveau compte arrive sur les boosters", async () => {
  const handler = confirm({
    verifyOtp: async input => {
      assert.equal(input.type, "signup");
      return { error: null };
    }
  });
  const response = await handler(
    new NextRequest(
      "https://yokkai.example/auth/confirm?token_hash=hash&type=signup"
    )
  );
  assert.equal(
    response.headers.get("location"),
    "https://yokkai.example/boosters"
  );
});

test("confirmation : récupération par code ou token vers la page de nouveau mot de passe", async () => {
  const handler = confirm({
    exchangeCodeForSession: async () => ({ error: null }),
    verifyOtp: async input => {
      assert.equal(input.type, "recovery");
      return { error: null };
    }
  });
  for (const query of [
    "code=valid&next=/reset-password",
    "token_hash=hash&type=recovery"
  ]) {
    const response = await handler(
      new NextRequest(`https://yokkai.example/auth/confirm?${query}`)
    );
    assert.equal(
      response.headers.get("location"),
      "https://yokkai.example/reset-password"
    );
  }
});

test("confirmation : utilise le domaine public configuré derrière le proxy", async () => {
  const handler = confirm(
    {
      exchangeCodeForSession: async () => ({ error: null })
    },
    { NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com" }
  );
  const response = await handler(
    new NextRequest(
      "https://localhost:3000/auth/confirm?code=valid&next=/reset-password"
    )
  );
  assert.equal(
    response.headers.get("location"),
    "https://yokkai-collec.com/reset-password"
  );
});

test("session : utilisateur vérifié par Auth et pseudo lu via RPC sans identifiant", async () => {
  const calls = [];
  const session = loadModule("../lib/auth/session.ts", {
    "server-only": {},
    react: { cache: fn => fn },
    "next/headers": { cookies: async () => ({}) },
    "@/utils/supabase/server": {
      createClient: () => ({
        auth: {
          getUser: async () => ({
            data: { user: { id: "verified-id" } },
            error: null
          })
        },
        rpc: async (...args) => {
          calls.push(args);
          return { data: { user: { name: "DB pseudo" } }, error: null };
        }
      })
    }
  });
  const user = await session.getCurrentUser();
  assert.equal(await session.getCurrentPseudo(user.id), "DB pseudo");
  assert.equal(user.id, "verified-id");
  assert.equal(await session.getCurrentPseudo("someone-else"), "DB pseudo");
  assert.deepEqual(calls, [["get_game_info"], ["get_game_info"]]);
});

test("renvoi : adresse validée, retour canonique, réponse neutre et délai", async () => {
  for (const error of [null, { code: "user_not_found", status: 400 }]) {
    let sent;
    const result = await actions({
      resend: async input => {
        sent = input;
        return { error };
      }
    }).resendConfirmation({}, form());
    assert.equal(sent.type, "signup");
    assert.equal(sent.email, "joueur@example.com");
    assert.equal(
      sent.options.emailRedirectTo,
      "https://yokkai.example/auth/confirm"
    );
    assert.equal(result.success, true);
    assert.equal(result.retryAfter, 60);
    assert.equal(JSON.stringify(result).includes("user_not_found"), false);
    assert.equal(JSON.stringify(result).includes("secret123"), false);
  }
  const invalid = await actions({
    resend: () => assert.fail("must not send")
  }).resendConfirmation({}, form({ email: "invalid" }));
  assert.ok(invalid.fields.email);
  const missingOrigin = await actions(
    { resend: () => assert.fail("must not send") },
    { NODE_ENV: "production" }
  ).resendConfirmation({}, form());
  assert.match(missingOrigin.error, /unavailable/);
});

test("e-mails : quota global, délai par adresse et SMTP ont des messages distincts", async () => {
  const cases = [
    [
      {
        code: "over_email_send_rate_limit",
        status: 429,
        message: "Email rate limit exceeded"
      },
      /email sending limit/i
    ],
    [
      {
        code: "over_email_send_rate_limit",
        status: 429,
        message:
          "For security purposes, you can only request this after 60 seconds."
      },
      /Too many attempts/
    ],
    [
      {
        code: "unexpected_failure",
        status: 500,
        message: "Error sending confirmation email"
      },
      /Email delivery.*unavailable/i
    ]
  ];
  for (const [error, expected] of cases) {
    const api = actions({
      resend: async () => ({ error }),
      signUp: async () => ({ data: { session: null }, error }),
      resetPasswordForEmail: async () => ({ error })
    });
    for (const operation of [
      "resendConfirmation",
      "signUp",
      "requestPasswordReset"
    ]) {
      const result = await api[operation]({}, form());
      assert.match(result.error, expected);
      assert.equal(result.success, undefined);
      assert.equal(JSON.stringify(result).includes(error.message), false);
    }
  }
  assert.match(
    forms.authEmailError({
      code: "unexpected_failure",
      status: 500,
      message: "Database error saving new user"
    }),
    /Sign-in/
  );
});

test("renvoi : erreur levée ou refus opérationnel ne devient jamais un succès", async () => {
  for (const resend of [
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => ({
      error: { code: "validation_failed", status: 400, message: "private" }
    })
  ]) {
    const result = await actions({ resend }).resendConfirmation({}, form());
    assert.ok(result.error);
    assert.equal(result.success, undefined);
    assert.equal(result.retryAfter, 60);
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
});

test("confirmation : indisponibilité Auth distincte d’un lien expiré ou consommé", async () => {
  for (const recovery of [false, true]) {
    const path = recovery ? "forgot-password?lien=" : "login?confirmation=";
    const query = recovery
      ? "token_hash=hash&type=recovery"
      : "token_hash=hash&type=signup";
    for (const verifyOtp of [
      async () => ({ error: { code: "unexpected_failure", status: 503 } }),
      async () => {
        throw new TypeError("fetch failed");
      }
    ]) {
      const response = await confirm({ verifyOtp })(
        new NextRequest("https://yokkai.example/auth/confirm?" + query)
      );
      assert.equal(
        response.headers.get("location"),
        "https://yokkai.example/" + path + "service"
      );
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
    const response = await confirm({
      verifyOtp: async () => ({ error: { code: "otp_expired", status: 403 } })
    })(new NextRequest("https://yokkai.example/auth/confirm?" + query));
    assert.equal(
      response.headers.get("location"),
      "https://yokkai.example/" + path + "erreur"
    );
  }
});

test("e-mails : les erreurs HTTP réelles du SDK conservent la distinction quota/SMTP", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  for (const [status, code, message, expected] of [
    [
      429,
      "over_email_send_rate_limit",
      "Email rate limit exceeded",
      /email sending limit/i
    ],
    [
      429,
      "over_email_send_rate_limit",
      "For security purposes, you can only request this after 60 seconds.",
      /Too many attempts/
    ],
    [
      500,
      "unexpected_failure",
      "Error sending confirmation email",
      /Email delivery.*unavailable/i
    ]
  ]) {
    let calls = 0;
    const client = createClient(
      "https://local-auth.example",
      "sb_publishable_local_dummy",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        },
        global: {
          fetch: async () => {
            calls++;
            return new Response(JSON.stringify({ code, msg: message }), {
              status,
              headers: {
                "Content-Type": "application/json",
                "X-Supabase-Api-Version": "2024-01-01"
              }
            });
          }
        }
      }
    );
    const { error } = await client.auth.resend({
      type: "signup",
      email: "joueur@example.com"
    });
    assert.equal(calls, 1);
    assert.ok(error);
    const result = await actions({
      resend: async () => ({ error })
    }).resendConfirmation({}, form());
    assert.match(result.error, expected);
    assert.equal(result.success, undefined);
    assert.equal(JSON.stringify(result).includes(message), false);
  }
});

test("captcha : transmis aux cinq parcours seulement si la clé publique est définie", async () => {
  const enabled = {
    NEXT_PUBLIC_SITE_URL: "https://yokkai.example",
    NODE_ENV: "production",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-local-test"
  };
  for (const env of [
    enabled,
    { ...enabled, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" }
  ]) {
    const sent = [];
    const api = actions(
      {
        signUp: async value => {
          sent.push(value.options);
          return { data: { session: null }, error: null };
        },
        signInWithPassword: async value => {
          sent.push(value.options);
          return {
            data: { user: { id: "user" } },
            error: { code: "invalid_credentials", status: 400 }
          };
        },
        resetPasswordForEmail: async (_, options) => {
          sent.push(options);
          return { error: null };
        },
        resend: async value => {
          sent.push(value.options);
          return { error: null };
        },
        getUser: async () => ({
          data: { user: { id: "user", email: "joueur@example.com" } },
          error: null
        })
      },
      env
    );
    const data = form({
      "cf-turnstile-response": "single-use-local",
      currentPassword: "old-password",
      confirmPassword: "  secret123  "
    });
    for (const name of [
      "signUp",
      "signIn",
      "requestPasswordReset",
      "resendConfirmation",
      "changePassword"
    ])
      await api[name]({}, data);
    assert.equal(sent.length, 5);
    for (const options of sent)
      assert.equal(
        options?.captchaToken,
        env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "single-use-local" : undefined
      );
  }
});

test("captcha : jeton absent, doublon ou trop long refusé avant tout appel Auth", async () => {
  for (const token of [undefined, "", "x".repeat(2049), " valid "]) {
    const data = form();
    if (token !== undefined) data.set("cf-turnstile-response", token);
    const api = actions(
      { signUp: () => assert.fail("must not call Auth") },
      {
        NEXT_PUBLIC_SITE_URL: "https://yokkai.example",
        NODE_ENV: "production",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-local-test"
      }
    );
    assert.match((await api.signUp({}, data)).error, /Bot verification/i);
  }
  const data = form({ "cf-turnstile-response": "one" });
  data.append("cf-turnstile-response", "two");
  assert.equal(forms.captchaOptions(data, "public-local-test"), undefined);
});

test("captcha : aucun second appel de connexion avec un jeton potentiellement consommé", async () => {
  let attempts = 0;
  const api = actions(
    {
      signInWithPassword: async () => {
        attempts++;
        throw new TypeError("fetch failed");
      }
    },
    {
      NEXT_PUBLIC_SITE_URL: "https://yokkai.example",
      NODE_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-local-test"
    }
  );
  const result = await api.signIn(
    {},
    form({ "cf-turnstile-response": "single-use-local" })
  );
  assert.equal(attempts, 1);
  assert.equal(result.success, undefined);
});

test("captcha : refus Auth à la récupération n’est jamais annoncé comme un envoi", async () => {
  const result = await actions({
    resetPasswordForEmail: async () => ({
      error: { code: "captcha_failed", status: 400 }
    })
  }).requestPasswordReset({}, form());
  assert.match(result.error, /Bot verification/i);
  assert.equal(result.success, undefined);
});

test("récupération : un refus sans code SDK ne devient pas un succès", async () => {
  const result = await actions({
    resetPasswordForEmail: async () => ({
      error: { status: 400, message: "Captcha verification failed" }
    })
  }).requestPasswordReset({}, form());
  assert.ok(result.error);
  assert.equal(result.success, undefined);
});

test("widget : jeton capturé puis renouvelé, y compris après reset et démontage", () => {
  const formTarget = new EventTarget();
  let field = "",
    generation = 0,
    removed = 0;
  const effects = [];
  const refs = [];
  const element = (type, props) => ({ type, props });
  const container = { closest: () => formTarget };
  const widget = loadModule(
    "../components/auth-turnstile.tsx",
    {
      "next/script": { default: "Script" },
      "react/jsx-runtime": { jsx: element, jsxs: element },
      react: {
        useId: () => "local-widget",
        useState: value => [value, () => {}],
        useRef: value => {
          const ref = { current: value === null ? container : value };
          refs.push(ref);
          return ref;
        },
        useCallback: callback => callback,
        useEffect: effect => effects.push(effect)
      }
    },
    {
      process: { env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-local-test" } },
      window: {
        turnstile: {
          render: (_container, options) => {
            assert.equal(options.language, "en");
            field = "token-" + ++generation;
            return "widget-local";
          },
          reset: () => {
            field = "token-" + ++generation;
          },
          remove: () => removed++
        }
      }
    }
  ).AuthTurnstile;
  const tree = widget();
  const cleanup = effects[0]();
  const script = tree.props.children.find(
    node => node?.props?.id === "auth-turnstile-local-widget"
  );
  script.props.onLoad();
  script.props.onReady();
  assert.equal(generation, 1);
  const first = field;
  // The native formdata event is emitted after copying the input values.
  const captured = new FormData();
  captured.set("cf-turnstile-response", field);
  formTarget.dispatchEvent(new Event("formdata"));
  assert.equal(captured.get("cf-turnstile-response"), first);
  assert.notEqual(field, first);
  const second = field;
  formTarget.dispatchEvent(new Event("reset"));
  assert.notEqual(field, second);
  cleanup();
  assert.equal(removed, 1);
  const after = field;
  formTarget.dispatchEvent(new Event("formdata"));
  assert.equal(field, after);
});

test("diagnostic Auth : jetons captcha et IP masqués dans erreurs objets et chaînes", async () => {
  const privateMessage =
    'Auth error joueur@example.com ip=198.51.100.12 IPv6=[2001:db8::12] mapped=::ffff:192.0.2.1 captcha_token="local-captcha-token"';
  const messages = [
    privateMessage,
    "Auth error joueur@example.com ip=198.51.100.12 IPv6=[2001:db8::12] mapped=::ffff:192.0.2.1",
    "Auth error opaque=" + "z".repeat(80)
  ];
  for (const error of messages.flatMap(message => [
    new Error(message),
    message
  ])) {
    const calls = [];
    const api = loadModule(
      "../app/auth/actions.ts",
      {
        "next/headers": { cookies: async () => ({}) },
        "next/navigation": { redirect: () => assert.fail("must not redirect") },
        "next/cache": { revalidatePath: () => {} },
        "@/utils/supabase/server": {
          createClient: () => ({
            auth: {
              signInWithPassword: async () => {
                throw error;
              }
            }
          })
        },
        "@/lib/auth/forms": forms
      },
      {
        process: { env: { NODE_ENV: "development" } },
        console: { error: (...args) => calls.push(args) }
      }
    );
    const result = await api.signIn({}, form());
    assert.ok(result.error);
    assert.equal(calls.length, 1);
    const logged = JSON.stringify(calls);
    for (const value of [
      "joueur@example.com",
      "198.51.100.12",
      "2001:db8::12",
      "::ffff:192.0.2.1",
      "local-captcha-token",
      "z".repeat(80)
    ])
      assert.equal(logged.includes(value), false, value);
    assert.match(logged, /redacted/);
  }
});

test("inscription : un domaine e-mail inexistant est signalé sur le champ, pas comme une panne", async () => {
  const smtpFailure = {
    code: "unexpected_failure",
    status: 500,
    message: "Error sending confirmation email"
  };
  const lookups = [];
  const missing = await actions({
    signUp: async () => ({ data: { session: null }, error: smtpFailure }),
    dns: {
      resolveMx: async domain => {
        lookups.push(domain);
        throw Object.assign(new Error("queryMx ENOTFOUND"), {
          code: "ENOTFOUND"
        });
      }
    }
  }).signUp({}, form({ email: "joueur@gmial.example" }));
  assert.deepEqual(lookups, ["gmial.example"]);
  assert.match(missing.fields.email, /couldn't find this email domain/);
  assert.equal(missing.error, undefined);
  assert.equal(missing.success, undefined);

  for (const resolveMx of [
    async () => [{ exchange: "mx.example", priority: 10 }],
    async () => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
    }
  ]) {
    const outage = await actions({
      signUp: async () => ({ data: { session: null }, error: smtpFailure }),
      dns: { resolveMx }
    }).signUp({}, form());
    assert.match(outage.error, /Email delivery.*unavailable/i);
    assert.equal(outage.fields, undefined);
  }
});

test("connexion : un compte non confirmé ouvre le renvoi du lien", async () => {
  const unconfirmed = await actions({
    signInWithPassword: async () => ({
      error: { code: "email_not_confirmed", status: 400 }
    })
  }).signIn({}, form());
  assert.equal(unconfirmed.needsConfirmation, true);
  assert.equal(unconfirmed.values.email, "joueur@example.com");
  const wrongPassword = await actions({
    signInWithPassword: async () => ({
      error: { code: "invalid_credentials", status: 400 }
    })
  }).signIn({}, form());
  assert.equal(wrongPassword.needsConfirmation, false);
  assert.match(
    readFileSync(
      new URL("../components/auth-form.tsx", import.meta.url),
      "utf8"
    ),
    /open=\{confirmationError \|\| state\.needsConfirmation \|\| undefined\}/
  );
});

test("e-mails Auth : modèles anglais, lien token_hash, servis hors text/html", () => {
  for (const [name, type] of [
    ["confirmation", "signup"],
    ["recovery", "recovery"]
  ]) {
    const html = readFileSync(
      new URL(`../public/auth-emails/${name}.html`, import.meta.url),
      "utf8"
    );
    const link = `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}`;
    // Button plus copyable fallback link, both intact Go template actions.
    assert.equal(html.split(link).length - 1, 3);
    assert.doesNotMatch(html, /<script|<img|https?:\/\/(?!yokkai)/i);
    assert.match(html, /<html lang="en">/);
  }
  const config = readFileSync(
    new URL("../next.config.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    config,
    /source: "\/auth-emails\/:path\*",\s*headers: \[\{ key: "Content-Type", value: "text\/plain; charset=utf-8" \}\]/
  );
});
