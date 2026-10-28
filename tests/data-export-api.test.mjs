import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  signalFromNodeResponse
} = require("next/dist/server/web/spec-extension/adapters/next-request.js");
function harness({
  user = true,
  recent = true,
  role = "authenticated",
  failure,
  rpcError = "EXPORT_TOO_LARGE",
  big = false,
  other = false
} = {}) {
  const calls = [],
    callbacks = [];
  const controller = new AbortController();
  const claims = {
    sub: "player-a",
    role,
    amr: [
      {
        method: "password",
        timestamp: Math.floor(Date.now() / 1000) - (recent ? 0 : 301)
      }
    ]
  };
  const client = {
    auth: {
      getClaims: async () => ({ data: { claims }, error: null }),
      getUser: async () => ({
        data: { user: user ? { id: "player-a" } : null },
        error: null
      })
    }
  };
  const admin = {
    rpc(name, args) {
      calls.push([name, args]);
      return {
        abortSignal: async () => ({
          data:
            name === "build_data_export"
              ? {
                  schema_version: 1,
                  account: { id: other ? "player-b" : "player-a" },
                  payload: big ? "x".repeat(26214401) : "safe"
                }
              : null,
          error: failure === name ? { message: rpcError, details: "120" } : null
        })
      };
    }
  };
  const exports = {};
  const load = p =>
    ts.transpileModule(readFileSync(new URL(p, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText;
  const recentExports = {};
  vm.runInNewContext(load("../lib/auth/recent-auth.ts"), {
    exports: recentExports
  });
  vm.runInNewContext(load("../app/api/data-export/route.ts"), {
    exports,
    Buffer,
    AbortSignal,
    AbortController,
    Response,
    Request,
    URL,
    process: {
      env: {
        NEXT_PUBLIC_SITE_URL: "https://site.test",
        SUPABASE_SECRET_KEY: "test-only"
      }
    },
    console: { error: () => {} },
    require: name =>
      ({
        "node:crypto": { randomUUID: () => "request-id" },
        "next/server": { after: cb => callbacks.push(cb) },
        "next/headers": {
          cookies: async () => ({ getAll: () => [], set: () => {} })
        },
        "@supabase/ssr": { createServerClient: () => client },
        "@supabase/supabase-js": { createClient: () => admin },
        "@/utils/supabase/config": {
          getSupabaseConfig: () => ({
            url: "https://db.test",
            key: "public-test",
            cookieName: "sb-test"
          })
        },
        "@/lib/auth/recent-auth": recentExports
      })[name]
  });
  const request = (body = "{}", origin = "https://site.test") =>
    new Request("https://site.test/api/data-export", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body,
      signal: controller.signal
    });
  return { calls, callbacks, controller, request, ...exports };
}

test("export refuses anonymous/stale/cross-origin/foreign-ID requests before reserving", async () => {
  for (const options of [
    { user: false },
    { recent: false },
    { role: "anon" }
  ]) {
    const h = harness(options),
      res = await h.POST(h.request());
    assert.ok([401, 403].includes(res.status));
    assert.equal(h.calls.length, 0);
    assert.match(res.headers.get("Cache-Control"), /no-store/);
  }
  for (const [body, origin] of [
    ["{}", "https://attacker.test"],
    ['{"user_id":"player-b"}', "https://site.test"],
    ["x".repeat(1025), "https://site.test"]
  ]) {
    const h = harness(),
      res = await h.POST(h.request(body, origin));
    assert.ok([400, 403].includes(res.status));
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  assert.equal(h.GET().status, 405);
  assert.match(h.GET().headers.get("Cache-Control"), /no-store/);
  const limited = harness({
    failure: "reserve_data_export",
    rpcError: "EXPORT_RATE_LIMITED"
  });
  const res = await limited.POST(limited.request());
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "120");
  assert.ok(!(await res.text()).includes("player-a"));
});

test("export consumes only after HTTP completion and releases generation failures/cancellation", async () => {
  const h = harness(),
    res = await h.POST(h.request());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).account.id, "player-a");
  assert.deepEqual(
    h.calls.map(([name]) => name),
    ["reserve_data_export", "build_data_export", "mark_data_export_sending"]
  );
  assert.match(
    res.headers.get("Content-Disposition"),
    /my-data-\d{4}-\d{2}-\d{2}\.json/
  );
  assert.ok(!res.headers.get("Content-Disposition").includes("player-a"));
  await h.callbacks[0]();
  assert.equal(h.calls.at(-1)[1].p_sent, true);
  assert.ok(h.calls.every(([, args]) => args.p_user_id === "player-a"));
  const cancelled = harness();
  await cancelled.POST(cancelled.request());
  cancelled.controller.abort();
  await cancelled.callbacks[0]();
  assert.equal(cancelled.calls.at(-1)[1].p_sent, false);
  for (const options of [
    { failure: "build_data_export" },
    { big: true },
    { other: true },
    { failure: "mark_data_export_sending" }
  ]) {
    const failed = harness(options),
      response = await failed.POST(failed.request());
    assert.ok(response.status >= 400);
    assert.equal(failed.calls.at(-1)[1].p_sent, false);
    assert.equal(failed.callbacks.length, 0);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
});

test("installed Next distinguishes successful HTTP finish from close/error; stream handoff cannot consume", () => {
  for (const finished of [true, false]) {
    const res = new EventEmitter();
    res.writableFinished = finished;
    const signal = signalFromNodeResponse(res);
    assert.equal(
      signal.aborted,
      false,
      "a constructed response is not a receipt"
    );
    res.emit("close");
    assert.equal(signal.aborted, !finished);
  }
  const failed = new EventEmitter();
  failed.errored = new Error("transport failed");
  assert.equal(signalFromNodeResponse(failed).aborted, true);
});

test("both oversized-export paths provide a safe support procedure without consuming the download", async () => {
  for (const options of [
    { failure: "build_data_export", rpcError: "EXPORT_TOO_LARGE" },
    { big: true }
  ]) {
    const h = harness(options);
    const response = await h.POST(h.request());
    assert.equal(response.status, 413);
    assert.match(response.headers.get("Cache-Control"), /private, no-store/);
    const { error } = await response.json();
    assert.match(error, /yokkaicollec@gmail\.com/);
    assert.match(error, /subject Data export request/);
    assert.match(error, /account email address/);
    assert.match(error, /complete export/);
    assert.match(error, /Do not send your password or sign-in codes/);
    assert.doesNotMatch(error, /player-a|request-id/);
    assert.equal(h.calls.at(-1)[0], "finish_data_export");
    assert.equal(h.calls.at(-1)[1].p_sent, false);
    assert.equal(h.callbacks.length, 0);
    assert.ok(!h.calls.some(([name]) => name === "mark_data_export_sending"));
  }
});
