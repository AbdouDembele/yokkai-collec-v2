import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("profile likes and visits are authenticated, idempotent, bounded, private and cleaned on account deletion", async t => {
  // Preserve every assertion of the original views contract on its exact schema.
  // Retirement and current likes contracts are checked separately on the full replay.
  const migrations = readdirSync(
    new URL("../supabase/migrations/", import.meta.url)
  )
    .filter(
      name =>
        name.endsWith(".sql") &&
        name <= "20261015000000_profile_active_auctions.sql"
    )
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  const [owner, viewer, other] = [1, 2, 3].map(
    n => `74000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  for (const [index, id] of [owner, viewer, other].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `SocialProfile${index}` })]
    );
  await db.exec("set role authenticated");
  const login = id =>
    db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  const stats = async (id = owner) =>
    (await db.query("select public.get_profile_engagement($1) value", [id]))
      .rows[0].value;
  const like = async (liked, id = owner) =>
    (await db.query("select public.set_profile_like($1,$2) value", [id, liked]))
      .rows[0].value;
  const visit = async (key, id = owner) =>
    (
      await db.query("select public.record_profile_view($1,$2) value", [
        id,
        key
      ])
    ).rows[0].value;
  const key = n => `74000000-0000-4000-8001-${String(n).padStart(12, "0")}`;
  await login(owner);
  assert.deepEqual(await stats(), { views: 0, likes: 0, likedByMe: false });
  assert.deepEqual(
    await visit(key(1)),
    { views: 0, likes: 0, likedByMe: false },
    "own visits do not inflate views"
  );
  await assert.rejects(like(true), /SELF_PROFILE_LIKE/);
  await login(viewer);
  assert.equal((await visit(key(1))).views, 1);
  assert.equal(
    (await visit(key(1))).views,
    1,
    "retry/StrictMode of one visit must not count twice"
  );
  assert.equal(
    (await visit(key(2))).views,
    2,
    "returning to the profile counts a new visit"
  );
  for (let i = 3; i <= 80; i++) await visit(key(i));
  assert.equal((await stats()).views, 80);
  await assert.rejects(visit(null), /INVALID_VISIT/);
  await assert.rejects(stats(null), /INVALID_PROFILE/);
  await assert.rejects(
    stats("74000000-0000-4000-8000-000000000099"),
    /PROFILE_NOT_FOUND/
  );
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await like(true)).likes,
      1,
      "setting like=true repeatedly leaves only one like"
    );
  assert.equal((await stats()).likedByMe, true);
  assert.equal((await like(false)).likes, 0);
  assert.equal(
    (await like(false)).likes,
    0,
    "repeated unlike does not decrement below zero"
  );
  await like(true);
  await login(other);
  assert.equal(
    (await stats()).likedByMe,
    false,
    "another viewer cannot inherit the first viewer's like state"
  );
  assert.equal((await like(true)).likes, 2);
  assert.equal(
    (await visit(key(1))).views,
    81,
    "different viewers can use the same visit identifier independently"
  );
  await login(owner);
  assert.deepEqual(await stats(), { views: 81, likes: 2, likedByMe: false });
  for (const table of ["profile_likes", "profile_visit_receipts"])
    await assert.rejects(
      db.query(`select * from public.${table}`),
      /permission denied/,
      "no viewer identities can be listed directly"
    );
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select cardinality(visit_ids) count from public.profile_visit_receipts where owner_id=$1 and user_id=$2",
        [owner, viewer]
      )
    ).rows[0].count,
    64
  );
  assert.equal(
    (await db.query("select count(*) count from public.profile_visit_receipts"))
      .rows[0].count,
    2,
    "storage is one row per pair, not one row per visit"
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values ($1,$2)",
    [owner, viewer]
  );
  await db.exec("set role authenticated");
  await login(viewer);
  await assert.rejects(visit(key(81)), /PROFILE_BLOCKED/);
  await assert.rejects(like(false), /PROFILE_BLOCKED/);
  assert.deepEqual(await stats(), { views: 81, likes: 2, likedByMe: true });
  await db.exec("reset role");
  await db.query(
    "delete from public.user_blocks where blocker_id=$1 and blocked_id=$2",
    [owner, viewer]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values ($1,$2)",
    [viewer, owner]
  );
  await db.exec("set role authenticated");
  await assert.rejects(visit(key(81)), /PROFILE_BLOCKED/);
  await assert.rejects(like(true), /PROFILE_BLOCKED/);
  await db.exec(
    "reset role; create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz); set role service_role"
  );
  const request = key(90);
  await db.query("select public.reserve_data_export($1,$2)", [viewer, request]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      viewer,
      request
    ])
  ).rows[0].value;
  assert.deepEqual(
    exported.profile_likes_sent.map(value => value.profile),
    ["SocialProfile0"]
  );
  assert.deepEqual(
    exported.profile_visits.map(value => ({
      profile: value.profile,
      views: value.views
    })),
    [{ profile: "SocialProfile0", views: 80 }]
  );
  assert.ok(!JSON.stringify(exported).includes("visit_ids"));
  assert.ok(!JSON.stringify(exported.profile_visits).includes(other));
  await db.exec("set role anon");
  await assert.rejects(stats(), /permission denied/);
  await assert.rejects(like(true), /permission denied/);
  await assert.rejects(visit(key(82)), /permission denied/);
  await db.exec("reset role; set role service_role");
  await db.query(
    "delete from public.user_blocks where blocker_id=$1 and blocked_id=$2",
    [viewer, owner]
  );
  await db.query("select public.begin_account_deletion($1)", [viewer]);
  await db.exec("set role authenticated");
  await login(viewer);
  await assert.rejects(visit(key(83)), /ACCOUNT_DELETED/);
  await assert.rejects(like(true), /ACCOUNT_DELETED/);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("delete from auth.users where id=$1", [viewer]);
  assert.equal(
    (await db.query("select count(*) count from public.profile_likes")).rows[0]
      .count,
    1
  );
  assert.equal(
    (await db.query("select count(*) count from public.profile_visit_receipts"))
      .rows[0].count,
    1
  );
  await db.query("delete from auth.users where id=$1", [owner]);
  assert.equal(
    (await db.query("select count(*) count from public.profile_likes")).rows[0]
      .count,
    0
  );
  assert.equal(
    (await db.query("select count(*) count from public.profile_visit_receipts"))
      .rows[0].count,
    0
  );
});
