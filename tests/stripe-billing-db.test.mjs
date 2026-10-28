import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const user = "00000000-0000-0000-0000-000000000001",
  other = "00000000-0000-0000-0000-000000000002";
const scope = "test:acct_example:price_example";
test("billing SQL denies all player access; fenced state/event writes are atomic, deduplicated and expiration-aware", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    insert into auth.users values('${user}'),('${other}');`);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261017000000_stripe_billing_foundation.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const sql of [
      `select * from public.billing_accounts`,
      `select * from public.billing_webhook_events`,
      `select public.billing_claim('${user}','${scope}')`,
      `select public.billing_has_pro('${user}','${scope}')`,
      `insert into public.billing_accounts(user_id,scope,active)values('${other}','${scope}',true)`
    ])
      await assert.rejects(db.query(sql), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  const claim = async uid =>
    (
      await db.query("select public.billing_claim($1,$2) as account", [
        uid,
        scope
      ])
    ).rows[0].account;
  const save = async (a, change = {}) =>
    (
      await db.query(
        "select public.billing_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          a.id,
          a.lease_token,
          change.customer ?? null,
          change.checkout ?? null,
          change.rotate ?? false,
          change.state ?? null,
          change.event ?? null,
          change.hold ?? false,
          change.prepareCustomer ?? false,
          change.prepareCheckout ?? false
        ]
      )
    ).rows[0];
  const pro = async () =>
    (
      await db.query("select public.billing_has_pro($1,$2) as pro", [
        user,
        scope
      ])
    ).rows[0].pro;
  const a = await claim(user);
  await assert.rejects(claim(user), /BILLING_BUSY/);
  assert.equal(await pro(), false);
  await save(a, { customer: "cus_example", prepareCustomer: true });
  await assert.rejects(
    save(a, { customer: "cus_hijacked" }),
    /BILLING_CUSTOMER_MISMATCH/
  );
  const state = {
    active: true,
    status: "active",
    endsAt: Math.floor(Date.now() / 1000) + 86400,
    cancelAtPeriodEnd: true
  };
  await save(a, { state, event: "evt_paid" });
  assert.equal(await pro(), true);
  await save(a, { state, event: "evt_paid" });
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.billing_webhook_events"
      )
    ).rows[0].n,
    1
  );
  await assert.rejects(
    save(a, { state: { ...state, status: "invalid" }, event: "evt_failed" }),
    /check constraint/
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.billing_webhook_events where event_id='evt_failed'"
      )
    ).rows[0].n,
    0
  );
  await db.query(
    "update public.billing_accounts set verified_at=now()-interval '16 minutes' where id=$1",
    [a.id]
  );
  assert.equal(await pro(), false);
  await save(a, { state: { ...state, endsAt: 1 } });
  assert.equal(await pro(), false);
  await save(a, { state: { ...state, status: "past_due", active: false } });
  assert.equal(await pro(), false);
  await save(a, { state, hold: true });
  assert.equal(await pro(), false);
  await save(a, { state });
  assert.equal(await pro(), false);
  await save(a, { checkout: "cs_test_old", prepareCheckout: true });
  await save(a, { rotate: true });
  const updated = (
    await db.query("select * from public.billing_accounts where id=$1", [a.id])
  ).rows[0];
  assert.notEqual(updated.checkout_nonce, a.checkout_nonce);
  assert.equal(updated.checkout_id, null);
  assert.equal(updated.checkout_started_at, null);
  await db.query(
    "update public.billing_accounts set lease_until=clock_timestamp()-interval '1 second' where id=$1",
    [a.id]
  );
  const next = await claim(user);
  await assert.rejects(save(a, { state }), /BILLING_LEASE_LOST/);
  await db.query("select public.billing_release($1,$2)", [a.id, a.lease_token]);
  await assert.rejects(claim(user), /BILLING_BUSY/);
  await db.query("select public.billing_release($1,$2)", [
    next.id,
    next.lease_token
  ]);
  const b = await claim(other);
  await assert.rejects(
    save(b, { customer: "cus_example" }),
    /unique constraint/
  );
  await db.exec("reset role");
  assert.equal(
    (await db.query("select count(*)::int as n from public.billing_accounts"))
      .rows[0].n,
    2
  );
});
