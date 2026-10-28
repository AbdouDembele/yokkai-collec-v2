import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import vm from "node:vm";

const user = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const scope = "test:acct_example:price_example";

test("durable billing quotas enforce each cap, isolate users/actions/scopes and recover without growing rows", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    insert into auth.users values('${user}'),('${other}');
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261018000000_billing_request_limits.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const sql of [
      "select * from public.billing_request_limits",
      "delete from public.billing_request_limits",
      `select public.billing_consume_request('${user}','${scope}','checkout')`,
      `insert into public.billing_request_limits values('${user}','${scope}','checkout',now(),1)`
    ])
      await assert.rejects(db.query(sql), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  const consume = async (action, uid = user, billingScope = scope) =>
    (
      await db.query(
        "select public.billing_consume_request($1,$2,$3) as retry",
        [uid, billingScope, action]
      )
    ).rows[0].retry;
  for (const [action, cap, duration] of [
    ["checkout", 10, 600],
    ["portal", 10, 300],
    ["status", 30, 60]
  ]) {
    for (let index = 0; index < cap; index++)
      assert.equal(await consume(action), 0);
    for (let index = 0; index < 3; index++) {
      const retry = await consume(action);
      assert.ok(retry > 0 && retry <= duration);
    }
    assert.equal(
      (
        await db.query(
          "select requests from public.billing_request_limits where user_id=$1 and scope=$2 and action=$3",
          [user, scope, action]
        )
      ).rows[0].requests,
      cap
    );
    assert.equal(await consume(action, other), 0);
    assert.equal(
      await consume(action, user, "live:acct_example:price_example"),
      0
    );
    await db.query(
      "update public.billing_request_limits set window_started_at=now()-interval '11 minutes' where user_id=$1 and scope=$2 and action=$3",
      [user, scope, action]
    );
    assert.equal(await consume(action), 0);
    assert.equal(
      (
        await db.query(
          "select requests from public.billing_request_limits where user_id=$1 and scope=$2 and action=$3",
          [user, scope, action]
        )
      ).rows[0].requests,
      1
    );
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.billing_request_limits"
      )
    ).rows[0].n,
    9
  );
  await assert.rejects(consume("anything"), /BILLING_INVALID_REQUEST/);
  await assert.rejects(consume("status", user, "invalid"), /check constraint/);
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1", [user]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.billing_request_limits where user_id=$1",
        [user]
      )
    ).rows[0].n,
    0
  );
});

class BillingError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
function loadLimiter(result, configError = false) {
  const calls = [];
  const compiled = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../lib/billing/rate-limit.ts", import.meta.url),
        "utf8"
      ),
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
      Number,
      require(id) {
        if (id === "server-only") return {};
        if (id === "./config")
          return {
            BillingError,
            billingConfig() {
              if (configError) throw new BillingError("BILLING_DISABLED", 404);
              return {
                database: "http://127.0.0.1:54321",
                serviceKey: "test-only-placeholder",
                scope
              };
            }
          };
        if (id === "@supabase/supabase-js")
          return {
            createClient(database, key, options) {
              calls.push({ database, options });
              return {
                async rpc(name, args) {
                  calls.push({ name, args });
                  return result;
                }
              };
            }
          };
        throw new Error(`Unexpected dependency ${id}`);
      }
    }
  );
  return { ...compiled.exports, calls };
}

test("quota adapter fails closed on unavailable or malformed storage and never accepts client quotas", async () => {
  for (const result of [
    { data: null, error: {} },
    { data: null, error: null },
    { data: -1, error: null },
    { data: 0.5, error: null },
    { data: 601, error: null },
    { data: "0", error: null }
  ]) {
    await assert.rejects(
      loadLimiter(result).consumeBillingRequest(user, "status"),
      /BILLING_STORAGE_UNAVAILABLE/
    );
  }
  const allowed = loadLimiter({ data: 0, error: null });
  await allowed.consumeBillingRequest(user, "portal");
  assert.equal(allowed.calls[1].name, "billing_consume_request");
  assert.deepEqual(JSON.parse(JSON.stringify(allowed.calls[1].args)), {
    p_user: user,
    p_scope: scope,
    p_action: "portal"
  });
  assert.equal(allowed.calls[0].options.auth.persistSession, false);
  const blocked = loadLimiter({ data: 60, error: null });
  await assert.rejects(
    blocked.consumeBillingRequest(user, "checkout"),
    error =>
      error instanceof blocked.BillingRateLimitError &&
      error.status === 429 &&
      error.retryAfterSeconds === 60
  );
  const disabled = loadLimiter(null, true);
  await assert.rejects(
    disabled.consumeBillingRequest(user, "status"),
    /BILLING_DISABLED/
  );
  assert.equal(disabled.calls.length, 0);
});

test("billing endpoint quotas run after authentication and input validation, before provider calls", () => {
  for (const action of ["checkout", "portal", "status"]) {
    const source = readFileSync(
      new URL(`../app/api/billing/${action}/route.ts`, import.meta.url),
      "utf8"
    );
    const authentication = source.indexOf("await billingUser(");
    const quota = source.indexOf(
      `await consumeBillingRequest(user.id, "${action}")`
    );
    const provider = source.indexOf("await configuredBillingService()");
    assert.ok(
      authentication >= 0 && quota > authentication && provider > quota
    );
    if (action !== "status")
      assert.ok(source.indexOf("await emptyBillingInput(request)") < quota);
  }
});
