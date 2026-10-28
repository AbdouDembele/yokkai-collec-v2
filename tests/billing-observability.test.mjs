import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { monitoredReconcileStripe } from "../scripts/reconcile-stripe.mjs";
function setup() {
  const logs = [];
  const cache = new Map();
  let now = 100000;
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const compiled = { exports: {} };
    cache.set(path, compiled.exports);
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync("lib/billing/" + path + ".ts", "utf8"),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022
          }
        }
      ).outputText,
      {
        module: compiled,
        exports: compiled.exports,
        Error,
        Date: class extends Date {
          static now() {
            return now;
          }
        },
        console: { error: s => logs.push(s) },
        require: id => (id === "server-only" ? {} : load(id.slice(2)))
      }
    );
    return compiled.exports;
  }
  return {
    logs,
    load,
    advance: () => {
      now += 60000;
    }
  };
}
test("billing failures produce bounded structured events without secrets; expected client refusals are silent", () => {
  const { logs, load, advance } = setup();
  const { BillingError } = load("config");
  const { logBillingFailure, logReconciliationFailure } = load("observability");
  for (const status of [400, 401, 403, 404, 409, 429])
    logBillingFailure("webhook", new BillingError("secret", status));
  assert.equal(logs.length, 0);
  logBillingFailure(
    "webhook",
    new Error("sk_live_secret email@example.com bearer-secret")
  );
  assert.equal(logs.length, 1);
  const first = JSON.parse(logs[0]);
  assert.equal(first.event, "billing.failure");
  assert.equal(first.operation, "webhook");
  assert.equal(first.code, "BILLING_UNAVAILABLE");
  assert.doesNotMatch(logs.join(""), /sk_live|email@|bearer|secret/);
  for (let i = 0; i < 100; i++)
    logBillingFailure("webhook", new Error("secret"));
  assert.equal(logs.length, 1);
  advance();
  logBillingFailure("webhook", new BillingError("BILLING_ACCOUNT_MISMATCH"));
  assert.equal(JSON.parse(logs[1]).code, "BILLING_ACCOUNT_MISMATCH");
  logBillingFailure("status", new BillingError("BILLING_secret_value"));
  assert.equal(JSON.parse(logs.at(-1)).code, "BILLING_UNAVAILABLE");
  logReconciliationFailure(10, 0);
  const before = logs.length;
  logReconciliationFailure(10, 2);
  assert.equal(logs.length, before + 1);
  const partial = JSON.parse(logs.at(-1));
  assert.equal(partial.failed, 2);
  assert.equal(partial.checked, 10);
});
test("scheduled reconciliation logs success and sanitized failures including cursor stalls and unreachable endpoint", async () => {
  const env = {
    NODE_ENV: "production",
    STRIPE_BILLING_MODE: "live",
    STRIPE_BILLING_ENABLED: "true",
    NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com",
    STRIPE_RECONCILIATION_SECRET: "a".repeat(32)
  };
  const logs = [];
  const log = s => logs.push(JSON.parse(s));
  await monitoredReconcileStripe(env, {
    log,
    fetchImpl: async () => Response.json({ checked: 3, failed: 0, next: null })
  });
  assert.equal(logs.at(-1).event, "billing.reconciliation_completed");
  assert.equal(logs.at(-1).checked, 3);
  await assert.rejects(
    monitoredReconcileStripe(env, {
      log,
      fetchImpl: async () => {
        throw Error("private credentials");
      }
    }),
    /REQUEST_FAILED/
  );
  assert.equal(logs.at(-1).event, "billing.reconciliation_failed");
  assert.equal(logs.at(-1).code, "STRIPE_RECONCILE_REQUEST_FAILED");
  await assert.rejects(
    monitoredReconcileStripe(env, {
      log,
      fetchImpl: async () =>
        Response.json({
          checked: 0,
          failed: 0,
          next: "11111111-1111-1111-1111-111111111111"
        })
    }),
    /CURSOR_INVALID/
  );
  assert.equal(logs.at(-1).code, "STRIPE_RECONCILE_CURSOR_INVALID");
  await assert.rejects(
    monitoredReconcileStripe(env, {
      log,
      fetchImpl: async () =>
        Response.json({ checked: 3, failed: 1, next: null }, { status: 503 })
    }),
    /ACCOUNTS_FAILED/
  );
  assert.equal(logs.at(-1).code, "STRIPE_RECONCILE_ACCOUNTS_FAILED");
  assert.doesNotMatch(JSON.stringify(logs), /private|credentials|aaaa/);
});
