import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const load = () => {
  const context = { exports: {}, URL, AbortSignal, JSON, Promise };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../lib/health.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020
        }
      }
    ).outputText,
    context
  );
  return context.exports.checkHealth;
};
const config = {
  url: "https://api.example.test",
  key: "sb_publishable_test"
};

test("health probe checks the database RPC and Auth with the public key only", async () => {
  const checkHealth = load();
  const calls = [];
  const result = await checkHealth(config, async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    database: true,
    auth: true
  });
  const urls = calls.map(call => call.url).sort();
  assert.deepEqual(urls, [
    "https://api.example.test/auth/v1/health",
    "https://api.example.test/rest/v1/rpc/is_pseudo_available"
  ]);
  for (const { init } of calls) {
    assert.equal(init.headers.apikey, "sb_publishable_test");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal, "each probe has a timeout");
  }
  const rpc = calls.find(call => call.url.includes("/rpc/"));
  assert.equal(rpc.init.method, "POST");
  assert.deepEqual(JSON.parse(rpc.init.body), { p_pseudo: "health-check" });
});

test("health probe reports each failure separately, including network errors", async () => {
  const checkHealth = load();
  const database = await checkHealth(config, async url =>
    String(url).includes("/rpc/") ? { ok: false } : { ok: true }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(database)), {
    database: false,
    auth: true
  });
  const auth = await checkHealth(config, async url => {
    if (String(url).includes("/auth/")) throw Error("timeout");
    return { ok: true };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(auth)), {
    database: true,
    auth: false
  });
});

test("health route answers 503 without details when a check fails", () => {
  const route = readFileSync(
    new URL("../app/api/health/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /status: ok \? 200 : 503/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.doesNotMatch(route, /error\.message|stack|process\.env/);
});
