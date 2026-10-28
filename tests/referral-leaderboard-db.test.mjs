import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const id = n => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("public referral ranking counts validated friends once, shares ties, searches beyond 100 and protects relationships", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id,raw_user_meta_data)
    select ('99000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      jsonb_build_object('pseudo','InviteRank'||lpad(n::text,3,'0')) from generate_series(1,282)n;
    insert into public.referral_codes(user_id,code)
      select ('99000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,lpad(to_hex(n),12,'0') from generate_series(1,130)n;
    insert into public.referrals(code_id,referrer_id,referred_id,verified_at,rewarded_at)
      select code_id,referrer_id,('99000000-0000-4000-8000-'||lpad((130+row_number() over(order by owner,n))::text,12,'0'))::uuid,now(),now()
      from (select c.id code_id,c.user_id referrer_id,owner,n from generate_series(1,130)owner
        join public.referral_codes c on c.user_id=('99000000-0000-4000-8000-'||lpad(owner::text,12,'0'))::uuid
        cross join lateral generate_series(1,case when owner=1 then 5 when owner in(2,3,4) then 4 when owner in(5,6,7) then 3 when owner=8 then 2 else 1 end)n) seeds;`);
  // A pending signup and a verified-but-not-validated relationship add no points.
  await db.query(
    `insert into public.referrals(code_id,referrer_id,referred_id,verified_at)
    select id,$1::uuid,$2::uuid,null::timestamptz from public.referral_codes where user_id=$1
    union all select id,$1::uuid,$3::uuid,now() from public.referral_codes where user_id=$1`,
    [id(1), id(281), id(282)]
  );
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(2)]
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [id(3)]
  );
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [id(4)]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($2,$1)",
    [id(1), id(5)]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted'),($3,$1,'accepted'),($1,$4,'pending'),($1,$5,'accepted')",
    [id(1), id(6), id(130), id(7), id(2)]
  );
  const read = async (
    query = "",
    friendsOnly = false,
    offset = 0,
    limit = 100,
    viewer = 1
  ) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(viewer)
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          "select public.get_referral_leaderboard($1,$2,$3,$4) value",
          [offset, limit, query, friendsOnly]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const top = await read();
  assert.equal(top.limit, 100);
  assert.equal(top.total, 99);
  assert.equal(top.entries.length, 99);
  assert.equal(top.rankedPlayers, 127);
  assert.equal(top.entries[0].pseudo, "InviteRank001");
  assert.equal(top.entries[0].verifiedReferrals, 5);
  assert.equal(top.entries.at(-1).pseudo, "InviteRank103");
  assert.deepEqual(
    top.entries.slice(0, 4).map(e => e.position),
    [1, 2, 2, 5]
  );
  assert.deepEqual(top.mine, {
    verifiedReferrals: 5,
    isPublic: true,
    position: 1
  });
  assert.equal(
    (await db.query("select count(*) count from public.user_cards")).rows[0]
      .count,
    0,
    "Referral rank does not require owning cards"
  );
  assert.deepEqual(
    Object.keys(top.entries[0]).sort(),
    [
      "avatarUrl",
      "isFriend",
      "position",
      "pseudo",
      "userId",
      "verifiedReferrals"
    ].sort()
  );
  assert.deepEqual(
    Object.keys(top.mine).sort(),
    ["verifiedReferrals", "isPublic", "position"].sort()
  );
  const found = await read("  iNvItErAnK130 ");
  assert.equal(found.query, "iNvItErAnK130");
  assert.equal(found.total, 1);
  assert.equal(found.entries[0].position, 6);
  assert.equal(found.entries[0].isFriend, true);
  const all = await read("InviteRank");
  assert.equal(all.total, 126);
  assert.equal(all.entries.length, 100);
  assert.equal((await read("InviteRank", false, 100)).entries.length, 26);
  for (const query of [
    "%",
    "_",
    "' OR true --",
    "InviteRank002",
    "InviteRank003",
    "InviteRank004",
    "InviteRank005",
    "InviteRank281"
  ]) {
    assert.equal((await read(query)).total, 0, query);
  }
  const friends = await read("", true);
  assert.deepEqual(
    friends.entries.map(e => e.userId),
    [id(1), id(6), id(130)]
  );
  assert.deepEqual(
    friends.entries.map(e => e.position),
    [1, 2, 6]
  );
  assert.deepEqual(
    friends.entries.map(e => e.isFriend),
    [false, true, true]
  );
  assert.equal((await read("InviteRank007", true)).total, 0);
  assert.equal((await read("InviteRank130", true)).entries[0].position, 6);
  const privateView = await read("", false, 0, 100, 2);
  assert.deepEqual(privateView.mine, {
    verifiedReferrals: 4,
    isPublic: false,
    position: null
  });
  assert.equal(
    privateView.entries.some(e => e.userId === id(2)),
    false
  );
  assert.deepEqual((await read("", false, 0, 100, 281)).mine, {
    verifiedReferrals: 0,
    isPublic: true,
    position: null
  });
  const bounded = await read("", false, -20, 9999);
  assert.equal(bounded.offset, 0);
  assert.equal(bounded.limit, 100);
  assert.equal((await read("x".repeat(100))).query.length, 64);
  // Deleted/banned children cease contributing; private children still count,
  // without revealing their identities or depending on the viewer's blocks.
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(131)]
  );
  assert.equal((await read()).mine.verifiedReferrals, 5);
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [id(132)]
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [id(133)]
  );
  assert.equal((await read()).mine.verifiedReferrals, 3);
  assert.equal((await read()).mine.position, 1);
  // Validation adds one count and does not award it repeatedly on refresh.
  await db.query(
    "update public.referrals set rewarded_at=now() where referred_id=$1",
    [id(282)]
  );
  assert.equal((await read()).mine.verifiedReferrals, 4);
  assert.equal((await read()).mine.verifiedReferrals, 4);
  await assert.rejects(read("", false, 0, 100, 3), /ACCOUNT_BANNED/);
  await assert.rejects(read("", false, 0, 100, 4), /PROFILE_MISSING/);
  await assert.rejects(
    db.query("select public.get_referral_leaderboard()"),
    /AUTH_REQUIRED/
  );
  for (const role of ["anon", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select public.get_referral_leaderboard()"),
      /permission denied/
    );
    await db.exec("reset role");
  }
});
