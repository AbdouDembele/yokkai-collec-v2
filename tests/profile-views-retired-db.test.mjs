import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("retiring profile views removes all tracking, preserves likes, exports and account cleanup", async t => {
  const migration = "20261015000001_retire_profile_views.sql";
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = readdirSync(directory)
    .filter(name => name.endsWith(".sql") && name < migration)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const [owner, viewer, other] = [1, 2, 3].map(
    n => `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  for (const [i, id] of [owner, viewer, other].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `RetiredViews${i}` })]
    );
  const login = async id => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const stats = async (id = owner) =>
    (await db.query("select public.get_profile_engagement($1) value", [id]))
      .rows[0].value;
  const like = async liked =>
    (
      await db.query("select public.set_profile_like($1,$2) value", [
        owner,
        liked
      ])
    ).rows[0].value;
  await login(viewer);
  await db.query("select public.record_profile_view($1,$2)", [
    owner,
    "76000000-0000-4000-8001-000000000001"
  ]);
  await like(true);
  await login(other);
  await like(true);
  await db.exec("reset role; set role service_role");
  const request = "76000000-0000-4000-8002-000000000001";
  await db.query("select public.reserve_data_export($1,$2)", [viewer, request]);
  const exportData = async () =>
    (
      await db.query("select public.build_data_export($1,$2) value", [
        viewer,
        request
      ])
    ).rows[0].value;
  const before = await exportData();
  assert.equal(before.profile_visits.length, 1);
  assert.equal(before.profile_likes_sent.length, 1);
  await db.exec("reset role");
  const likeDefinition = (
    await db.query(
      "select pg_get_functiondef('public.set_profile_like(uuid,boolean)'::regprocedure) value"
    )
  ).rows[0].value;
  const oldExport = (
    await db.query(
      "select prosrc from pg_proc where oid='public.build_data_export(uuid,uuid)'::regprocedure"
    )
  ).rows[0].prosrc;
  const oldReceipts = (
    await db.query(
      "select * from public.profile_visit_receipts order by owner_id,user_id"
    )
  ).rows;
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  const objects = (
    await db.query(
      "select to_regclass('public.profile_visit_receipts') receipts,to_regprocedure('public.record_profile_view(uuid,uuid)') recorder"
    )
  ).rows[0];
  assert.equal(objects.receipts, "profile_visit_receipts");
  assert.equal(objects.recorder, null);
  assert.deepEqual(
    (
      await db.query(
        "select * from public.profile_visit_receipts order by owner_id,user_id"
      )
    ).rows,
    oldReceipts,
    "Retirement must not destroy legacy private data without separate approval"
  );
  assert.equal(
    (
      await db.query(
        "select prosrc from pg_proc where oid='public.build_data_export(uuid,uuid)'::regprocedure"
      )
    ).rows[0].prosrc,
    oldExport,
    "Retained personal history and all export reservations/bounds/permissions are unchanged"
  );
  assert.equal(
    (
      await db.query(
        "select pg_get_functiondef('public.set_profile_like(uuid,boolean)'::regprocedure) value"
      )
    ).rows[0].value,
    likeDefinition,
    "Like rules and locks are unchanged"
  );
  await db.exec("set role service_role");
  const after = await exportData();
  assert.equal(after.profile_visits.length, 1);
  assert.deepEqual(after.profile_engagement, { likes: 0, views: 0 });
  for (const key of Object.keys(before).filter(key => key !== "exported_at"))
    assert.deepEqual(
      after[key],
      before[key],
      `Export section ${key} is preserved`
    );
  await login(viewer);
  assert.deepEqual(await stats(), { likes: 2, likedByMe: true });
  for (let i = 0; i < 5; i++)
    assert.deepEqual(
      await stats(),
      { likes: 2, likedByMe: true },
      "Repeated profile reads have no view counter or write"
    );
  await assert.rejects(
    db.query("select * from public.profile_visit_receipts"),
    /permission denied/
  );
  await assert.rejects(
    db.query(
      "insert into public.profile_visit_receipts(owner_id,user_id,visit_ids) values($1,$2,array[$3::uuid])",
      [owner, viewer, "76000000-0000-4000-8001-000000000002"]
    ),
    /permission denied/
  );
  await assert.rejects(
    db.query("select public.record_profile_view($1,$2)", [
      owner,
      "76000000-0000-4000-8001-000000000002"
    ]),
    /does not exist/
  );
  assert.equal((await like(false)).likes, 1);
  assert.equal((await like(false)).likes, 1);
  assert.deepEqual(await like(true), { likes: 2, likedByMe: true });
  assert.equal((await like(true)).likes, 2);
  await login(owner);
  await assert.rejects(like(true), /SELF_PROFILE_LIKE/);
  await db.exec("reset role");
  for (const [blocker, blocked] of [
    [owner, viewer],
    [viewer, owner]
  ]) {
    await db.query(
      "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
      [blocker, blocked]
    );
    await login(viewer);
    await assert.rejects(like(false), /PROFILE_BLOCKED/);
    await db.exec("reset role; delete from public.user_blocks");
  }
  await db.exec("set role anon");
  await assert.rejects(stats(), /permission denied/);
  await assert.rejects(like(true), /permission denied/);
  await db.exec("reset role; set role service_role");
  await db.query("select public.begin_account_deletion($1)", [viewer]);
  await login(viewer);
  await assert.rejects(like(true), /ACCOUNT_DELETED/);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  assert.deepEqual(
    (
      await db.query(
        "select * from public.profile_visit_receipts order by owner_id,user_id"
      )
    ).rows,
    oldReceipts,
    "Reads and likes cannot alter legacy receipts"
  );
  await db.query("delete from auth.users where id=$1", [viewer]);
  assert.equal(
    (await db.query("select count(*) n from public.profile_likes")).rows[0].n,
    1
  );
  assert.equal(
    (await db.query("select count(*) n from public.profile_visit_receipts"))
      .rows[0].n,
    0,
    "Account removal still cleans legacy private history"
  );
  await db.query("delete from auth.users where id=$1", [owner]);
  assert.equal(
    (await db.query("select count(*) n from public.profile_likes")).rows[0].n,
    0
  );
});
