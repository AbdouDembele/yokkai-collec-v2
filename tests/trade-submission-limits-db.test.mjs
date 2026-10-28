import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const id = n => `99500000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("trade admission bounds notifications, serial budgets and pending offers without changing assets", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (let n = 1; n <= 105; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [
        id(n),
        JSON.stringify({
          pseudo: `TradeLimit${n}`,
          is_admin: true,
          is_pro: true
        })
      ]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) select $1,id,'accepted' from auth.users where id<>$1",
    [id(1)]
  );
  const initialBalances = (
    await db.query(
      "select sum(karas_balance)::text total from public.user_profiles"
    )
  ).rows[0].total;
  const player = async (n, sql, args = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(n)
    ]);
    await db.exec("set role authenticated");
    try {
      return await db.query(sql, args);
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const offer = (from, to = 1, parent = null) =>
    player(from, "select public.create_trade_offer($1,'{}',1,'{}',0,$2) id", [
      id(to),
      parent
    ]);
  // 100 independent accounts cannot each flood the same recipient indefinitely.
  for (let n = 2; n <= 101; n++) {
    for (let i = 0; i < 5; i++) await offer(n);
    await assert.rejects(offer(n), /TRADE_PAIR_LIMIT/);
  }
  assert.equal(
    (await db.query("select count(*)::integer n from public.trade_offers"))
      .rows[0].n,
    500
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.notifications where type='trade_offer_received'"
      )
    ).rows[0].n,
    500
  );
  assert.equal(
    (
      await db.query(
        "select sum(karas_balance)::text total from public.user_profiles"
      )
    ).rows[0].total,
    initialBalances
  );
  // Successful creations consume the budget even when immediately cancelled.
  for (let i = 0; i < 10; i++) {
    const made = (await offer(102)).rows[0].id;
    await player(102, "select public.cancel_trade_offer($1)", [made]);
  }
  assert.equal(
    (
      await db.query(
        "select submissions from public.trade_offer_submission_limits where user_id=$1",
        [id(102)]
      )
    ).rows[0].submissions,
    10
  );
  await assert.rejects(offer(102), /TRADE_OFFER_RATE_LIMITED/);
  await db.query(
    "update public.trade_offer_submission_limits set window_started_at=clock_timestamp()-interval '11 minutes' where user_id=$1",
    [id(102)]
  );
  await offer(102);
  assert.equal(
    (
      await db.query(
        "select submissions from public.trade_offer_submission_limits where user_id=$1",
        [id(102)]
      )
    ).rows[0].submissions,
    1
  );
  // Trusted historical fixtures do not generate admission rows; live player RPCs do.
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) select $1,id,'accepted' from auth.users where id not in($1,$2) order by id limit 20",
    [id(103), id(1)]
  );
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_karas) select $1,id,1 from auth.users where id not in($1,$2) limit 20",
    [id(103), id(1)]
  );
  await assert.rejects(offer(103), /TRADE_PENDING_LIMIT/);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.trade_offer_submission_limits where user_id=$1",
        [id(103)]
      )
    ).rows[0].n,
    0,
    "rejection rolls back the admission row"
  );
  // A refused counteroffer must leave its parent pending, with no notification.
  const parent = (await offer(1, 104)).rows[0].id;
  await db.query(
    "insert into public.trade_offer_submission_limits values($1,clock_timestamp(),10)",
    [id(104)]
  );
  await assert.rejects(offer(104, 1, parent), /TRADE_OFFER_RATE_LIMITED/);
  assert.equal(
    (
      await db.query("select status from public.trade_offers where id=$1", [
        parent
      ])
    ).rows[0].status,
    "pending"
  );
  for (const sql of [
    "select * from public.trade_offer_submission_limits",
    "delete from public.trade_offer_submission_limits",
    "select public.guard_trade_offer_submission()"
  ])
    await assert.rejects(player(102, sql), /permission denied/);
  await db.query("delete from auth.users where id=$1", [id(102)]);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.trade_offer_submission_limits where user_id=$1",
        [id(102)]
      )
    ).rows[0].n,
    0
  );
});
