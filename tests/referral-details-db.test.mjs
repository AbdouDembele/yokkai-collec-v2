import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const id = n => `95000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("referral details expose only the caller's invitees, correct launch counts, dates and permitted profile fields", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column created_at timestamptz default '2026-10-01T10:00:00Z'"
  );
  for (const n of [1, 2, 3, 4, 5, 6])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [
        id(n),
        JSON.stringify({ pseudo: `Referral${n}`, secret: "Never expose this" })
      ]
    );
  await db.query(
    "insert into public.referral_codes(user_id,code) values($1,'123456abcdef'),($2,'abcdef123456')",
    [id(1), id(2)]
  );
  for (const n of [3, 4, 5])
    await db.query(
      `insert into public.referrals(code_id,referrer_id,referred_id,created_at,verified_at)
      select id,$1,$2,'2026-10-05T12:00:00Z',case when $3 then '2026-10-06T12:00:00Z'::timestamptz else null end from public.referral_codes where user_id=$1`,
      [id(1), id(n), n !== 5]
    );
  await db.query(
    `insert into public.referrals(code_id,referrer_id,referred_id)
    select id,$1,$2 from public.referral_codes where user_id=$1`,
    [id(2), id(6)]
  );
  await db.query(
    "insert into public.profile_media_assets(path,user_id,purpose,mime_type,animated,public_url) values($1,$2,'avatar','image/png',false,'https://i.imgur.com/referral.png')",
    [id(3) + "/avatar.png", id(3)]
  );
  await db.query(
    "update public.user_profiles set avatar_url='https://i.imgur.com/referral.png' where user_id=$1",
    [id(3)]
  );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(4)]
  );
  await db.query(
    "update public.user_achievement_stats set regular_packs_opened=9,profile_decision_packs_offset=2 where user_id=$1",
    [id(3)]
  );
  await db.query(
    "insert into public.decision_packs(user_id,status) values($1,'claimed'),($1,'claimed'),($1,'pending')",
    [id(3)]
  );
  const login = async user => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const get = async () =>
    (await db.query("select public.get_my_referrals() value")).rows[0].value;
  await login(id(1));
  const page = await get();
  assert.equal(page.total, 3);
  assert.equal(page.limit, 20);
  const person = page.referrals.find(r => r.id === id(3));
  assert.equal(person.pseudo, "Referral3");
  assert.equal(person.avatarUrl, "https://i.imgur.com/referral.png");
  assert.equal(person.boostersOpened, 10);
  assert.equal(
    new Date(person.accountCreatedAt).toISOString(),
    "2026-10-01T10:00:00.000Z"
  );
  assert.equal(
    new Date(person.referredAt).toISOString(),
    "2026-10-05T12:00:00.000Z"
  );
  assert.equal(
    new Date(person.verifiedAt).toISOString(),
    "2026-10-06T12:00:00.000Z"
  );
  assert.deepEqual(
    Object.keys(person).sort(),
    [
      "id",
      "pseudo",
      "avatarUrl",
      "boostersOpened",
      "accountCreatedAt",
      "referredAt",
      "verifiedAt"
    ].sort()
  );
  assert.equal(page.referrals.find(r => r.id === id(4)).boostersOpened, null);
  assert.equal(page.referrals.find(r => r.id === id(5)).verifiedAt, null);
  await assert.rejects(
    db.query("select * from public.referrals"),
    /permission denied/
  );
  await login(id(2));
  assert.deepEqual(
    (await get()).referrals.map(r => r.id),
    [id(6)]
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [id(1), id(4)]
  );
  await login(id(1));
  assert.equal(
    (await get()).referrals.find(r => r.id === id(4)).boostersOpened,
    0
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [id(3), id(1)]
  );
  await login(id(1));
  assert.equal((await get()).total, 2);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [id(1), id(5)]
  );
  await login(id(1));
  assert.deepEqual(
    (await get()).referrals.map(r => r.id),
    [id(4)]
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [id(4)]
  );
  await login(id(1));
  assert.equal((await get()).total, 0);
});

test("referral pagination is bounded, stable, authenticated and handles empty and deleted accounts", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [id(1), JSON.stringify({ pseudo: "ReferralOwner" })]
  );
  await db.query(
    "insert into public.referral_codes(user_id,code) values($1,'123456abcdef')",
    [id(1)]
  );
  for (let n = 10; n < 35; n++) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: `Paginated${n}` })]
    );
    await db.query(
      `insert into public.referrals(code_id,referrer_id,referred_id,created_at)
      select id,$1,$2,'2026-10-05T12:00:00Z' from public.referral_codes where user_id=$1`,
      [id(1), id(n)]
    );
  }
  await assert.rejects(
    db.query("select public.get_my_referrals()"),
    /AUTH_REQUIRED/
  );
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select public.get_my_referrals()"),
    /permission denied/
  );
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(1)
  ]);
  const get = async (offset, limit = 20) =>
    (
      await db.query("select public.get_my_referrals($1,$2) value", [
        offset,
        limit
      ])
    ).rows[0].value;
  const first = await get(0),
    second = await get(20);
  assert.equal(first.total, 25);
  assert.equal(first.referrals.length, 20);
  assert.equal(second.referrals.length, 5);
  assert.equal(
    new Set([...first.referrals, ...second.referrals].map(r => r.id)).size,
    25
  );
  assert.deepEqual(
    (await get(0)).referrals.map(r => r.id),
    first.referrals.map(r => r.id)
  );
  const bounded = await get(-10, 10000);
  assert.equal(bounded.offset, 0);
  assert.equal(bounded.limit, 50);
  assert.equal((await get(99999)).referrals.length, 0);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("delete from auth.users where id=$1", [id(34)]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(1)
  ]);
  assert.equal((await get(0)).total, 24);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(10)
  ]);
  assert.deepEqual((await get(0)).referrals, []);
});
