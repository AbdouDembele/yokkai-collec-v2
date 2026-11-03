import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("account status distinguishes proven self-deletion, unknown deletion, bans and exact processed transfers without reopening recovery", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column banned_until timestamptz,add column email text,add column updated_at timestamptz;create table auth.sessions(user_id uuid)"
  );
  const [admin, primary, self, unknown, banned, unbanned] = [
    1, 2, 3, 4, 5, 6
  ].map(i => `ac650000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  for (const [i, id] of [
    admin,
    primary,
    self,
    unknown,
    banned,
    unbanned
  ].entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email)values($1,$2,$3)",
      [
        id,
        JSON.stringify({ pseudo: `Status${i}` }),
        `status${i}@example.invalid`
      ]
    );
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id)values($1,$2)",
      [`v1:${"d".repeat(64)}`, id]
    );
  }
  await db.query("insert into public.admin_users(user_id)values($1)", [admin]);
  await db.query(
    "update public.user_profiles set karas_balance=1000 where user_id=$1",
    [primary]
  );
  const as = async (role, user, sql, args = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? ""
    ]);
    await db.exec(`set role ${role}`);
    try {
      return (await db.query(sql, args)).rows[0]?.value;
    } finally {
      await db.exec("reset role");
    }
  };
  const read = (sql, args = []) => as("authenticated", admin, sql, args);
  for (const id of [banned, unbanned])
    await read("select public.admin_set_user_ban($1,true)value", [id]);
  await read("select public.admin_set_user_ban($1,false)value", [unbanned]);
  const trade = async source => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      source
    ]);
    await db.query(
      "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')",
      [source, primary]
    );
    const id = (
      await db.query(
        "insert into public.trade_offers(from_user,to_user,offered_karas,status)values($1,$2,15,'pending')returning id",
        [source, primary]
      )
    ).rows[0].id;
    await db.query(
      "update public.trade_offers set status='accepted'where id=$1",
      [id]
    );
    return id;
  };
  const selfTrade = await trade(self),
    unknownTrade = await trade(unknown);
  for (const role of ["anon", "authenticated"])
    await assert.rejects(
      as(
        role,
        primary,
        "select public.begin_self_requested_account_deletion($1)value",
        [self]
      ),
      /permission denied/
    );
  // Only the confirmed server path records a self request; other deletion
  // callers, including an interrupted old fence, retain unknown provenance.
  await as(
    "service_role",
    null,
    "select public.begin_self_requested_account_deletion($1)value",
    [self]
  );
  await as(
    "service_role",
    null,
    "select public.begin_self_requested_account_deletion($1)value",
    [self]
  );
  for (const id of [unknown, banned, unbanned])
    await as(
      "service_role",
      null,
      "select public.begin_account_deletion($1)value",
      [id]
    );
  await as(
    "service_role",
    null,
    "select public.begin_self_requested_account_deletion($1)value",
    [unknown]
  );
  for (const id of [self, unknown, banned, unbanned]) {
    await as(
      "service_role",
      null,
      "select public.prepare_account_deletion($1)value",
      [id]
    );
    await db.query("delete from auth.users where id=$1", [id]);
  }
  const list = async () =>
    read("select public.admin_list_deleted_accounts('',$1,true,30,0)value", [
      primary
    ]);
  let listing = await list();
  const source = listing.accounts.find(a => a.userId === self);
  assert.equal(source.accountState.deleted, true);
  assert.equal(source.accountState.deletionOrigin, "self");
  assert.equal(source.accountState.pseudo, "Status2");
  assert.equal(source.accountState.sanctionApplied, false);
  assert.equal(source.availableTransfers, 1);
  assert.equal(
    listing.accounts.find(a => a.userId === unknown).accountState
      .deletionOrigin,
    "unknown"
  );
  const connections = async () =>
    read("select public.admin_list_anticheat_connections($1)value", [
      [primary]
    ]);
  let peers = (await connections())[primary].accounts;
  assert.equal(
    peers.find(a => a.userId === banned).accountState.bannedAtDeletion,
    true
  );
  assert.equal(
    peers.find(a => a.userId === unbanned).accountState.bannedAtDeletion,
    false
  );
  const preview = await read(
    "select public.admin_preview_deleted_account_sanction($1,$2)value",
    [primary, [self]]
  );
  assert.equal(preview.eligible, true);
  const result = await read(
    "select public.admin_apply_deleted_account_sanction($1,$2,'Verified fixture decision',$1,$3)value",
    [primary, [self], preview.previewToken]
  );
  assert.equal(result.karasRecovered, 15);
  listing = await list();
  assert.equal(
    listing.accounts.find(a => a.userId === self).availableTransfers,
    0
  );
  assert.equal(
    listing.accounts.find(a => a.userId === self).accountState.sanctionApplied,
    true
  );
  assert.ok(
    Date.parse(
      listing.accounts.find(a => a.userId === self).accountState
        .sanctionAppliedAt
    )
  );
  assert.equal(
    listing.accounts.find(a => a.userId === unknown).availableTransfers,
    1
  );
  assert.equal(
    listing.accounts.find(a => a.userId === unknown).accountState
      .sanctionApplied,
    false
  );
  peers = (await connections())[primary].accounts;
  assert.equal(
    peers.find(a => a.userId === self).accountState.sanctionApplied,
    true
  );
  assert.equal(
    peers.find(a => a.userId === unknown).accountState.sanctionApplied,
    false
  );
  const events = (
    await read(
      "select public.admin_list_anticheat_events($1,'trade_accepted',100,0)value",
      [primary]
    )
  ).events;
  const processed = events.find(e => e.subjectId === selfTrade),
    untouched = events.find(e => e.subjectId === unknownTrade);
  assert.equal(processed.sanctionApplied, true);
  assert.equal(processed.actor.accountState.deletionOrigin, "self");
  assert.equal(processed.detail.fromState.pseudo, "Status2");
  assert.equal(untouched.sanctionApplied, false);
  // Ban and case review status are independent of gain recovery.
  await read("select public.admin_set_user_ban($1,true)value", [primary]);
  const cases = (
    await read("select public.admin_list_anticheat_cases('', '',50,0)value")
  ).cases;
  assert.equal(cases.find(c => c.userId === primary).accountState.banned, true);
  assert.equal(
    cases.find(c => c.userId === primary).accountState.sanctionApplied,
    true
  );
  for (const role of ["anon", "authenticated", "service_role"])
    await assert.rejects(
      as(role, admin, "select public.anticheat_account_display($1,null)value", [
        self
      ]),
      /permission denied/
    );
  await assert.rejects(
    as(
      "authenticated",
      unbanned,
      "select public.admin_list_deleted_accounts('',$1,true,30,0)value",
      [primary]
    ),
    /ADMIN_REQUIRED|ACCOUNT_DELETED/
  );
  await assert.rejects(
    read(
      "select public.admin_apply_deleted_account_sanction($1,$2,'Verified fixture decision',$1,$3)value",
      [primary, [self], preview.previewToken]
    ),
    /SANCTION_PREVIEW_CHANGED|DELETED_ACCOUNTS_NOT_ELIGIBLE/
  );
  // Expiry removes names in every new projection; it does not erase the
  // independently recorded deletion origin or sanction receipt.
  await db.query(
    "update public.anticheat_deleted_accounts set identity_expires_at=now()-interval '1 second'where user_id=$1",
    [self]
  );
  assert.equal(
    (await connections())[primary].accounts.find(a => a.userId === self)
      .accountState.pseudo,
    null
  );
  assert.equal(
    (await list()).accounts.find(a => a.userId === self).accountState.pseudo,
    null
  );
});
