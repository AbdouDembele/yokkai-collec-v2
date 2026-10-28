import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as net from "node:net";
import * as crypto from "node:crypto";

function load(env, incoming, calls) {
  const source = ts.transpileModule(
    readFileSync(
      new URL("../utils/supabase/auth-fetch.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    process: { env },
    Buffer,
    URL,
    Request,
    Headers,
    fetch: async request => {
      calls.push(request);
      return new Response("{}");
    },
    require: name => {
      if (name === "server-only") return {};
      if (name === "next/headers") return { headers: async () => incoming };
      if (name === "node:net") return net;
      if (name === "node:crypto") return crypto;
      throw new Error("Unexpected import: " + name);
    }
  });
  return exports;
}

const secret = "a".repeat(64); // Local test fixture only, never an operational credential.
const publicUrl = "https://api.yokkai.example";
const env = {
  AUTH_REAL_IP_ENABLED: "true",
  SUPABASE_AUTH_INTERNAL_URL: "http://supabase-envoy:8000",
  AUTH_PROXY_SECRET: secret
};

test("IP : le mode actuel ignore les en-têtes déclarés et conserve l’API publique", async () => {
  const calls = [];
  const api = load(
    {},
    new Headers({
      "cf-connecting-ip": "198.51.100.12",
      "x-auth-proxy-secret": secret
    }),
    calls
  );
  await api.serverAuthFetch(publicUrl)(publicUrl + "/auth/v1/recover", {
    method: "POST",
    body: "{}",
    headers: {
      "x-auth-client-ip": "203.0.113.9",
      "sb-forwarded-for": "203.0.113.8",
      "x-auth-proxy-secret": "browser"
    }
  });
  assert.equal(calls[0].url, publicUrl + "/auth/v1/recover");
  for (const header of [
    "x-auth-client-ip",
    "sb-forwarded-for",
    "x-auth-proxy-secret"
  ])
    assert.equal(calls[0].headers.get(header), null);
});

test("IP : deux joueurs ont des IP distinctes sur le chemin interne, sans perte du corps Auth", async () => {
  const calls = [];
  for (const ip of ["198.51.100.12", "2001:db8::12"]) {
    const api = load(
      env,
      new Headers({
        "cf-connecting-ip": ip,
        "x-auth-proxy-secret": secret,
        "x-forwarded-for": "203.0.113.1"
      }),
      calls
    );
    await api.serverAuthFetch(publicUrl)(publicUrl + "/auth/v1/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: "public-local-dummy"
      },
      body: JSON.stringify({
        email: "local@example.com",
        gotrue_meta_security: { captcha_token: "single-use-local" }
      })
    });
  }
  assert.deepEqual(
    calls.map(r => r.headers.get("x-auth-client-ip")),
    ["198.51.100.12", "2001:db8::12"]
  );
  for (const req of calls) {
    assert.equal(req.url, "http://supabase-envoy:8000/auth/v1/signup");
    assert.equal(req.headers.get("apikey"), "public-local-dummy");
    const body = await req.json();
    assert.equal(body.email, "local@example.com");
    assert.equal(body.gotrue_meta_security.captcha_token, "single-use-local");
  }
});

test("IP : un navigateur sans preuve ou avec IP ambiguë ne peut atteindre Auth interne", async () => {
  for (const headers of [
    { "cf-connecting-ip": "198.51.100.12" },
    { "cf-connecting-ip": "198.51.100.12", "x-auth-proxy-secret": "wrong" },
    {
      "cf-connecting-ip": "198.51.100.12, 203.0.113.1",
      "x-auth-proxy-secret": secret
    },
    { "x-forwarded-for": "198.51.100.12", "x-auth-proxy-secret": secret },
    { "cf-connecting-ip": "invalid", "x-auth-proxy-secret": secret }
  ]) {
    const calls = [];
    const api = load(env, new Headers(headers), calls);
    await assert.rejects(
      api.serverAuthFetch(publicUrl)(publicUrl + "/auth/v1/token", {
        method: "POST",
        body: "{}"
      }),
      /origine|confiance/i
    );
    assert.equal(calls.length, 0);
  }
});

test("IP : la réécriture est limitée à Auth et ne transmet rien aux autres services", async () => {
  const calls = [];
  const api = load(env, new Headers(), calls);
  for (const target of [
    publicUrl + "/rest/v1/rpc/test",
    "https://other.example/auth/v1/signup"
  ]) {
    await api.serverAuthFetch(publicUrl)(target);
  }
  assert.deepEqual(
    calls.map(r => (typeof r === "string" ? r : r.url)),
    [publicUrl + "/rest/v1/rpc/test", "https://other.example/auth/v1/signup"]
  );
});

test("IP : un chemin interne partiellement configuré est refusé sans exposer ses valeurs", async () => {
  for (const configured of [
    {
      AUTH_REAL_IP_ENABLED: "true",
      SUPABASE_AUTH_INTERNAL_URL: env.SUPABASE_AUTH_INTERNAL_URL
    },
    { ...env, AUTH_PROXY_SECRET: "short" },
    {
      ...env,
      SUPABASE_AUTH_INTERNAL_URL: "http://user:password@supabase-envoy:8000"
    }
  ]) {
    const calls = [];
    const api = load(
      configured,
      new Headers({
        "cf-connecting-ip": "198.51.100.12",
        "x-auth-proxy-secret": secret
      }),
      calls
    );
    await assert.rejects(
      api.serverAuthFetch(publicUrl)(publicUrl + "/auth/v1/user"),
      error =>
        !error.message.includes(secret) &&
        !error.message.includes("user:password")
    );
    assert.equal(calls.length, 0);
  }
});

test("IP : Request, paramètres et domaine externe restent corrects, redirections refusées", async () => {
  const calls = [];
  const api = load(
    env,
    new Headers({
      "cf-connecting-ip": "198.51.100.12",
      "x-auth-proxy-secret": secret
    }),
    calls
  );
  await api.serverAuthFetch(publicUrl)(
    new Request(publicUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      body: "{}",
      headers: { "x-forwarded-host": "browser.example" }
    })
  );
  const req = calls[0];
  assert.equal(
    req.url,
    "http://supabase-envoy:8000/auth/v1/token?grant_type=password"
  );
  assert.equal(req.headers.get("x-forwarded-host"), "api.yokkai.example");
  assert.equal(req.headers.get("x-forwarded-proto"), "https");
  assert.equal(req.redirect, "error");
});

test("cookies : le nom historique dépend de l’URL publique, jamais de l’adresse interne", () => {
  const source = ts.transpileModule(
    readFileSync(
      new URL("../utils/supabase/config.ts", import.meta.url),
      "utf8"
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  for (const internal of [undefined, "http://supabase-envoy:8000"]) {
    const exports = {};
    vm.runInNewContext(source, {
      exports,
      URL,
      process: {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://api.yokkai-collec.com",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-local-dummy",
          SUPABASE_AUTH_INTERNAL_URL: internal
        }
      }
    });
    const config = exports.getSupabaseConfig();
    assert.equal(config.cookieName, "sb-api-auth-token");
    assert.equal(config.url, "https://api.yokkai-collec.com");
  }
});

test("IP : URL seule et indicateur seul sont inertes, seule leur combinaison active le chemin", async () => {
  for (const configured of [
    { SUPABASE_AUTH_INTERNAL_URL: env.SUPABASE_AUTH_INTERNAL_URL },
    { ...env, AUTH_REAL_IP_ENABLED: undefined },
    { ...env, AUTH_REAL_IP_ENABLED: "false" },
    { ...env, AUTH_REAL_IP_ENABLED: "TRUE" },
    { ...env, AUTH_REAL_IP_ENABLED: "1" },
    { ...env, SUPABASE_AUTH_INTERNAL_URL: undefined },
    env
  ]) {
    const calls = [];
    const incoming = new Headers({
      "cf-connecting-ip": "198.51.100.12",
      "x-auth-proxy-secret": secret
    });
    const api = load(configured, incoming, calls);
    await api.serverAuthFetch(publicUrl)(publicUrl + "/auth/v1/user");
    const enabled =
      configured.AUTH_REAL_IP_ENABLED === "true" &&
      Boolean(configured.SUPABASE_AUTH_INTERNAL_URL);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      enabled
        ? "http://supabase-envoy:8000/auth/v1/user"
        : publicUrl + "/auth/v1/user"
    );
    assert.equal(
      calls[0].headers.get("x-auth-client-ip"),
      enabled ? "198.51.100.12" : null
    );
    assert.equal(
      calls[0].headers.get("x-auth-proxy-secret"),
      enabled ? secret : null
    );
  }
});
