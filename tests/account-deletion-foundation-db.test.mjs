import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const first = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
const survivor = "10000000-0000-4000-8000-000000000003";

test("deleting Auth users retains detached histories without NULL uniqueness collisions", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values
    ($1,'{"pseudo":"DeleteOne"}'),($2,'{"pseudo":"DeleteTwo"}'),($3,'{"pseudo":"Survivor"}')`,
    [first, second, survivor]
  );
  const auction = (
    await db.query(
      `insert into public.auctions
    (seller_id,buyer_id,starting_price,duration_minutes,ends_at,status,current_price)
    values ($1,$2,10,60,now()-interval '1 hour','sold',20) returning id`,
      [first, second]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,20)",
    [auction, second]
  );
  await db.query(
    `insert into public.friendships(user_id,friend_id,status)
    values ($1,$2,'accepted'),($1,$3,'accepted'),($2,$3,'accepted')`,
    [first, second, survivor]
  );
  await db.query(
    `insert into public.trade_offers(from_user,to_user,offered_karas,status)
    values ($1,$3,10,'accepted'),($3,$2,10,'declined'),($1,$2,10,'accepted')`,
    [first, second, survivor]
  );
  await db.query(
    `insert into public.user_reports(reporter_id,reported_id,reason,context_type)
    values ($1,$3,'spam','profile'),($2,$3,'spam','profile'),
    ($3,$1,'spam','profile'),($3,$2,'spam','profile')`,
    [first, second, survivor]
  );
  // Live identities must still be deduplicated.
  await assert.rejects(
    db.query(
      `insert into public.user_reports(reporter_id,reported_id,reason,context_type)
    values ($1,$2,'spam','profile')`,
      [first, survivor]
    ),
    error => error.code === "23505"
  );
  const card = (
    await db.query(`insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values ('delete-history','History','ANIME/MANGA','TEST','SR','https://example.test/card.jpg','manual') returning id`)
  ).rows[0].id;
  await db.query(
    `insert into public.card_reports(reporter_id,card_id,reason) values
    ($1,$3,'image_issue'),($2,$3,'image_issue')`,
    [first, second, card]
  );
  await db.query(
    `insert into public.admin_audit_logs(admin_user_id,action) values
    ($1,'card.update'),($2,'card.update')`,
    [first, second]
  );
  // SQL is used only in this disposable test to exercise the FK effects of Auth deletion.
  await db.query("delete from auth.users where id=$1", [first]);
  await db.query("delete from auth.users where id=$1", [second]);
  assert.deepEqual(
    (
      await db.query(
        "select seller_id,buyer_id from public.auctions where id=$1",
        [auction]
      )
    ).rows,
    [{ seller_id: null, buyer_id: null }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select bidder_id,amount from public.bids where auction_id=$1",
        [auction]
      )
    ).rows,
    [{ bidder_id: null, amount: 20 }]
  );
  const trades = (
    await db.query("select from_user,to_user from public.trade_offers")
  ).rows;
  assert.equal(trades.length, 3);
  assert.ok(
    trades.every(row =>
      [row.from_user, row.to_user].every(id => id === null || id === survivor)
    )
  );
  const reports = (
    await db.query("select reporter_id,reported_id from public.user_reports")
  ).rows;
  assert.equal(reports.length, 4);
  assert.ok(
    reports.every(row =>
      [row.reporter_id, row.reported_id].every(
        id => id === null || id === survivor
      )
    )
  );
  assert.deepEqual(
    (await db.query("select reporter_id from public.card_reports")).rows,
    [{ reporter_id: null }, { reporter_id: null }]
  );
  assert.deepEqual(
    (await db.query("select admin_user_id from public.admin_audit_logs")).rows,
    [{ admin_user_id: null }, { admin_user_id: null }]
  );
  assert.deepEqual(
    (await db.query("select user_id from public.user_profiles")).rows,
    [{ user_id: survivor }]
  );
});

test("deletion journal is exactly UUID/date, survives Auth deletion and is service_role only", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  assert.deepEqual(
    (
      await db.query(`select column_name,data_type from information_schema.columns
    where table_schema='public' and table_name='account_deletion_log' order by ordinal_position`)
    ).rows,
    [
      { column_name: "user_id", data_type: "uuid" },
      { column_name: "deleted_at", data_type: "timestamp with time zone" }
    ]
  );
  for (const role of ["anon", "authenticated"]) {
    for (const privilege of [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER"
    ]) {
      assert.equal(
        (
          await db.query(
            "select has_table_privilege($1,'public.account_deletion_log',$2) as allowed",
            [role, privilege]
          )
        ).rows[0].allowed,
        false
      );
    }
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select * from public.account_deletion_log"),
      error => error.code === "42501"
    );
    await assert.rejects(
      db.query("insert into public.account_deletion_log(user_id) values ($1)", [
        first
      ]),
      error => error.code === "42501"
    );
    await db.exec("reset role");
  }
  assert.equal(
    (
      await db.query(`select count(*)::int as grants from pg_class c,
    lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid='public.account_deletion_log'::regclass and a.grantee=0`)
    ).rows[0].grants,
    0
  );
  assert.equal(
    (
      await db.query(
        "select relrowsecurity from pg_class where oid='public.account_deletion_log'::regclass"
      )
    ).rows[0].relrowsecurity,
    true
  );
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"Journal"}\')',
    [first]
  );
  await db.exec("set role service_role");
  await db.query(
    "insert into public.account_deletion_log(user_id) values ($1)",
    [first]
  );
  const stored = (
    await db.query("select user_id,deleted_at from public.account_deletion_log")
  ).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].user_id, first);
  assert.ok(stored[0].deleted_at);
  await assert.rejects(
    db.query("insert into public.account_deletion_log(user_id) values ($1)", [
      first
    ]),
    error => error.code === "23505"
  );
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1", [first]);
  await db.exec("set role service_role");
  assert.deepEqual(
    (
      await db.query(
        "select user_id,deleted_at from public.account_deletion_log"
      )
    ).rows,
    stored
  );
});
