import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const id = n => `93000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("verified-referral ranking increases with verified invites, shares ties and ignores pending or deleted accounts", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (let n = 1; n <= 20; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: `RankPlayer${n}` })]
    );
  for (const n of [1, 2, 3, 4, 5])
    await db.query(
      "insert into public.referral_codes(user_id,code) values($1,$2)",
      [id(n), n.toString(16).padStart(12, "0")]
    );
  let child = 6;
  for (const [owner, count] of [
    [1, 5],
    [2, 3],
    [3, 3],
    [4, 1]
  ])
    for (let n = 0; n < count; n++)
      await db.query(
        `insert into public.referrals(code_id,referrer_id,referred_id,verified_at,rewarded_at)
        select id,$1,$2,now(),now() from public.referral_codes where user_id=$1`,
        [id(owner), id(child++)]
      );
  await db.query(
    `insert into public.referrals(code_id,referrer_id,referred_id)
    select id,$1,$2 from public.referral_codes where user_id=$1`,
    [id(5), id(18)]
  );
  const rank = async user => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    return (await db.query("select public.get_referral_rank() value")).rows[0]
      .value;
  };
  await assert.rejects(
    db.query("select public.get_referral_rank()"),
    /AUTH_REQUIRED/
  );
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select public.get_referral_rank()"),
    /permission denied/
  );
  await db.exec("reset role;set role authenticated");
  assert.deepEqual(await rank(id(1)), {
    position: 1,
    topPercent: 10,
    totalPlayers: 20,
    verifiedReferrals: 5
  });
  assert.deepEqual(await rank(id(2)), {
    position: 2,
    topPercent: 20,
    totalPlayers: 20,
    verifiedReferrals: 3
  });
  assert.deepEqual(await rank(id(3)), await rank(id(2)));
  assert.deepEqual(await rank(id(4)), {
    position: 4,
    topPercent: 20,
    totalPlayers: 20,
    verifiedReferrals: 1
  });
  assert.deepEqual(await rank(id(5)), {
    position: null,
    topPercent: null,
    totalPlayers: 20,
    verifiedReferrals: 0
  });
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [id(6)]
  );
  await db.exec("set role authenticated");
  assert.deepEqual(await rank(id(1)), {
    position: 1,
    topPercent: 10,
    totalPlayers: 19,
    verifiedReferrals: 4
  });
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [id(1)]
  );
  await db.exec("set role authenticated");
  await assert.rejects(rank(id(1)), /PROFILE_MISSING/);
});

test("a whole tied population is not mislabeled as the top ten percent", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const n of [1, 2, 3, 4])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: `TiedPlayer${n}` })]
    );
  for (const [owner, child] of [
    [1, 3],
    [2, 4]
  ]) {
    await db.query(
      "insert into public.referral_codes(user_id,code) values($1,$2)",
      [id(owner), owner.toString(16).padStart(12, "0")]
    );
    await db.query(
      `insert into public.referrals(code_id,referrer_id,referred_id,verified_at,rewarded_at)
      select id,$1,$2,now(),now() from public.referral_codes where user_id=$1`,
      [id(owner), id(child)]
    );
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(1)
  ]);
  const rank = (await db.query("select public.get_referral_rank() value"))
    .rows[0].value;
  assert.deepEqual(rank, {
    position: 1,
    topPercent: 50,
    totalPlayers: 4,
    verifiedReferrals: 1
  });
});
