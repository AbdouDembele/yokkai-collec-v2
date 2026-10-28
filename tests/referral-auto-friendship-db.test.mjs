import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const referrer = "72000000-0000-4000-8000-000000000001";
const referred = "72000000-0000-4000-8000-000000000002";
const blockedReferred = "72000000-0000-4000-8000-000000000003";

test("a verified referral rewards both players without creating a friendship", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const login = async id => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const friendships = async () =>
    (
      await db.query(
        "select user_id,friend_id,status from public.friendships order by friend_id"
      )
    ).rows;

  await db.query(
    "insert into auth.users(id,raw_user_meta_data,email_confirmed_at) values($1,$2::jsonb,clock_timestamp())",
    [referrer, JSON.stringify({ pseudo: "Sponsor" })]
  );
  await login(referrer);
  const code = (await db.query("select public.create_referral_code() value"))
    .rows[0].value;
  await db.exec("reset role");

  for (const [id, pseudo] of [
    [referred, "Newcomer"],
    [blockedReferred, "Blocked"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo, referral_code: code })]
    );
  assert.deepEqual(
    await friendships(),
    [],
    "an unverified referral adds no friend"
  );

  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [blockedReferred, referrer]
  );
  await db.query(
    "update auth.users set email_confirmed_at=clock_timestamp() where id = any($1)",
    [[referred, blockedReferred]]
  );
  assert.deepEqual(
    await friendships(),
    [],
    "neither a blocked nor unblocked referral creates a friendship"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int value from public.notifications where type='friend_request'"
      )
    ).rows[0].value,
    0,
    "referral verification sends no friendship notification"
  );

  await login(referred);
  const list = (await db.query("select public.get_friendships() value")).rows[0]
    .value;
  assert.deepEqual(
    list.friends.map(friend => friend.id),
    []
  );
  await db.exec("reset role");
  const bonuses = (
    await db.query(
      "select user_id,bonus_regular_packs from public.user_profiles order by user_id"
    )
  ).rows;
  assert.deepEqual(bonuses, [
    { user_id: referrer, bonus_regular_packs: 10 },
    { user_id: referred, bonus_regular_packs: 5 },
    { user_id: blockedReferred, bonus_regular_packs: 5 }
  ]);
  await login(referred);
  await db.query("select public.send_friend_request($1)", [referrer]);
  await db.exec("reset role");
  assert.deepEqual(
    await friendships(),
    [{ user_id: referred, friend_id: referrer, status: "pending" }],
    "friendships still require an explicit request"
  );
});
