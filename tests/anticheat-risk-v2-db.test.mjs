import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261102180000_anticheat_risk_model_v2.sql";

async function asAuthenticated(db, user, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

test("risk model v2 keeps volume evidence without flagging high-volume players", async t => {
  const migrations = readdirSync(
    new URL("../supabase/migrations/", import.meta.url)
  )
    .filter(name => name.endsWith(".sql") && name < migration)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());

  const bidder = "ac400000-0000-4000-8000-000000000001";
  const seller = "ac400000-0000-4000-8000-000000000002";
  const admin = "ac400000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [bidder, "VolumeBidder"],
    [seller, "VolumeSeller"],
    [admin, "VolumeAdmin"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);

  for (let index = 0; index < 30; index++)
    await db.query(
      "select public.record_anticheat_event('auction_bid',$1,$2,null,10,1,$3,clock_timestamp()-interval '4 days')",
      [bidder, seller, JSON.stringify({ startingPrice: 10 })]
    );

  assert.ok(
    (
      await db.query(
        "select risk_score from public.anticheat_cases where user_id=$1",
        [bidder]
      )
    ).rows[0].risk_score > 0,
    "the previous model accumulated risk from ordinary volume"
  );
  const eventCountBefore = (
    await db.query(
      "select count(*)::integer total from public.anticheat_events where event_type='auction_bid' and actor_user_id=$1",
      [bidder]
    )
  ).rows[0].total;

  await db.exec(
    readFileSync(
      new URL(`../supabase/migrations/${migration}`, import.meta.url),
      "utf8"
    )
  );

  const afterMigration = (
    await asAuthenticated(
      db,
      admin,
      "select public.admin_list_anticheat_cases('VolumeBidder') value"
    )
  ).rows[0].value;
  assert.equal(afterMigration.total, 0);
  assert.deepEqual(afterMigration.cases, []);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_events where event_type='auction_bid' and actor_user_id=$1",
        [bidder]
      )
    ).rows[0].total,
    eventCountBefore,
    "the immutable audit history is preserved"
  );

  for (let index = 0; index < 30; index++)
    await db.query(
      "select public.record_anticheat_event('auction_bid',$1,$2,null,10,1,$3,clock_timestamp()-interval '3 days')",
      [bidder, seller, JSON.stringify({ startingPrice: 10 })]
    );
  assert.equal(
    (
      await asAuthenticated(
        db,
        admin,
        "select public.admin_list_anticheat_cases('VolumeBidder') value"
      )
    ).rows[0].value.total,
    0,
    "playing often does not create a risk case"
  );
});

test("risk model v2 caps corroborating signals and resets after a dismissal", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const source = "ac500000-0000-4000-8000-000000000001";
  const recipient = "ac500000-0000-4000-8000-000000000002";
  const admin = "ac500000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [source, "CappedSource"],
    [recipient, "CappedRecipient"],
    [admin, "CappedAdmin"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);

  const suspiciousTrade = JSON.stringify({
    offeredTotal: 1,
    requestedTotal: 0,
    offeredValue: 100,
    requestedValue: 0
  });
  for (let index = 0; index < 10; index++)
    await db.query(
      "select public.record_anticheat_event('trade_accepted',$1,$2,null,0,1,$3,clock_timestamp()-interval '4 days')",
      [source, recipient, suspiciousTrade]
    );

  const capped = (
    await asAuthenticated(
      db,
      admin,
      "select public.admin_list_anticheat_cases('CappedRecipient') value"
    )
  ).rows[0].value;
  assert.equal(capped.cases[0].score, 42);
  assert.equal(capped.cases[0].severity, "high");
  assert.deepEqual(capped.cases[0].reasonCodes, [
    "ONE_WAY_TRADE_BENEFICIARY",
    "TRADE_VALUE_IMBALANCE"
  ]);

  await asAuthenticated(
    db,
    admin,
    "select public.admin_review_anticheat_case($1,'dismissed','Verified as legitimate high-volume activity.')",
    [recipient]
  );
  const dismissed = (
    await asAuthenticated(
      db,
      admin,
      "select public.admin_list_anticheat_cases('CappedRecipient') value"
    )
  ).rows[0].value.cases[0];
  assert.equal(dismissed.score, 0);
  assert.equal(dismissed.status, "dismissed");
  assert.deepEqual(dismissed.reasonCodes, []);

  await db.query(
    "select public.record_anticheat_event('trade_accepted',$1,$2,null,0,1,$3)",
    [source, recipient, suspiciousTrade]
  );
  const reopened = (
    await asAuthenticated(
      db,
      admin,
      "select public.admin_list_anticheat_cases('CappedRecipient') value"
    )
  ).rows[0].value.cases[0];
  assert.equal(reopened.status, "open");
  assert.ok(reopened.score > 0);
});
