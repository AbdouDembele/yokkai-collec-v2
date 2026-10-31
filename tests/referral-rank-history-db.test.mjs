import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const id = n => "98000000-0000-4000-8000-" + String(n).padStart(12, "0");
test("Referral history tracks real authorized ranks without exposing private or blocked players", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id,raw_user_meta_data) select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,jsonb_build_object('pseudo','RefHistory'||n) from generate_series(1,5)n;
 insert into public.referral_codes(user_id,code) values ('${id(1)}','98abcdef1234'),('${id(2)}','98abcdef1235');
 insert into public.referrals(code_id,referrer_id,referred_id,verified_at,rewarded_at) select id,user_id,'${id(3)}',now(),now() from public.referral_codes where user_id='${id(1)}';
 insert into public.referrals(code_id,referrer_id,referred_id,verified_at,rewarded_at) select id,user_id,'${id(4)}',now(),now() from public.referral_codes where user_id='${id(2)}';`);
  const read = async (viewer = 1) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(viewer)
    ]);
    await db.exec("set role authenticated");
    try {
      return (await db.query("select public.get_referral_leaderboard() value"))
        .rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const first = await read();
  assert.equal(first.mine.position, 1);
  assert.equal(first.history[id(1)].delta, null);
  assert.equal(first.history[id(1)].observations.length, 1);
  await db.query(
    "insert into public.leaderboard_rank_observations(user_id,ranking_key,observed_day,position) values($1,'referrals',current_date-7,4)",
    [id(1)]
  );
  assert.equal((await read()).history[id(1)].delta, 3);
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(2)]
  );
  const hidden = await read();
  assert(!hidden.entries.some(e => e.userId === id(2)));
  assert.equal(hidden.history[id(2)], undefined);
  const ownPrivate = await read(2);
  assert.equal(ownPrivate.mine.isPublic, false);
  assert.equal(ownPrivate.history[id(2)], undefined);
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [id(2)]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [id(1), id(2)]
  );
  const blocked = await read();
  assert(!blocked.entries.some(e => e.userId === id(2)));
  assert.equal(blocked.history[id(2)], undefined);
  assert.equal((await read(5)).history[id(5)], undefined);
  for (const role of ["anon", "authenticated"]) {
    const rights = (
      await db.query(
        "select has_table_privilege($1,'public.leaderboard_rank_observations','select,insert,update,delete') allowed",
        [role]
      )
    ).rows[0];
    assert.equal(rights.allowed, false);
  }
});
