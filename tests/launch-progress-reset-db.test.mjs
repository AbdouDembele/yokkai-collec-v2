import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import { resetLaunchProgressSQL } from "../scripts/admin/reset-launch-progress.mjs";

const id = n => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture(t) {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column created_at timestamptz default now()"
  );
  for (const n of [1, 2, 3])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: `Progress${n}` })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [id(2)]);
  await db.query(
    `update public.user_achievement_stats set regular_packs_opened=107,
    decision_packs_completed=4,auctions_won=3,trades_completed=5,ssr_evolved_to_lr=2 where user_id=$1`,
    [id(1)]
  );
  await db.query(
    "update public.user_achievement_stats set regular_packs_opened=50 where user_id=$1",
    [id(2)]
  );
  await db.query(
    "update public.user_achievement_stats set regular_packs_opened=2 where user_id=$1",
    [id(3)]
  );
  for (let n = 0; n < 4; n++)
    await db.query(
      "insert into public.decision_packs(user_id,status) values($1,'claimed')",
      [id(1)]
    );
  await db.query(
    "insert into public.decision_packs(user_id,status) values($1,'pending')",
    [id(1)]
  );
  await db.exec(`insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values('${id(10)}','progress-fixture','Progress card','ANIME/MANGA','Progress','LR','https://i.imgur.com/test.png','manual')`);
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR')",
    [id(1), id(10)]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values($1,$2)",
    [id(2), id(10)]
  );
  await db.exec(
    "update public.user_profiles set karas_balance=200,bonus_regular_packs=7,next_decision_pack_at=now()+interval '20 hours'"
  );
  for (const n of [1, 2, 3])
    await db.query(
      "select public.complete_achievements($1,array['regular_packs_opened'])",
      [id(n)]
    );
  await db.exec("update public.user_achievements set claimed_at=completed_at");
  const baseline = [
    {
      user_id: id(1),
      regular: 100,
      decision: 3,
      decisionOpened: 3,
      decisionEverOpened: 3,
      auctions: 2,
      trades: 4,
      evolved: 2
    },
    {
      user_id: id(2),
      regular: 50,
      decision: 0,
      decisionOpened: 0,
      decisionEverOpened: 1,
      auctions: 0,
      trades: 0,
      evolved: 0
    }
  ];
  const rows = async table =>
    (
      await db.query(
        `select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`
      )
    ).rows;
  const profile = async user =>
    (await db.query("select public.get_profile_details($1) value", [user]))
      .rows[0].value;
  return { db, baseline, rows, profile };
}

test("launch progress subtracts the original snapshot, retains later openings/new accounts, resets every achievement and preserves assets", async t => {
  const { db, baseline, rows, profile } = await fixture(t);
  const tables = [
    "auth.users",
    "public.user_cards",
    "public.wishlists",
    "public.decision_packs"
  ];
  const before = await Promise.all(tables.map(rows));
  const profilesBefore = (
    await db.query(
      "select user_id,next_decision_pack_at,to_jsonb(p)-'next_decision_pack_at' protected from public.user_profiles p order by user_id"
    )
  ).rows;
  // Additional openings after the audit must survive the eventual transaction.
  await db.query(
    "update public.user_achievement_stats set regular_packs_opened=regular_packs_opened+2 where user_id=$1",
    [id(1)]
  );
  await db.exec(resetLaunchProgressSQL(baseline, { commit: true }));
  assert.deepEqual(await Promise.all(tables.map(rows)), before);
  const profilesAfter = (
    await db.query(
      "select user_id,next_decision_pack_at,to_jsonb(p)-'next_decision_pack_at' protected from public.user_profiles p order by user_id"
    )
  ).rows;
  assert.deepEqual(
    profilesAfter.map(p => p.protected),
    profilesBefore.map(p => p.protected)
  );
  assert.deepEqual(
    profilesAfter[0].next_decision_pack_at,
    profilesBefore[0].next_decision_pack_at
  );
  assert.ok(new Date(profilesAfter[1].next_decision_pack_at) <= new Date());
  assert.deepEqual(
    profilesAfter[2].next_decision_pack_at,
    profilesBefore[2].next_decision_pack_at
  );
  const stats = (
    await db.query(
      "select * from public.user_achievement_stats where user_id=$1",
      [id(1)]
    )
  ).rows[0];
  assert.equal(stats.regular_packs_opened, 9);
  assert.equal(stats.decision_packs_completed, 1);
  assert.equal(stats.auctions_won, 1);
  assert.equal(stats.trades_completed, 1);
  assert.equal(stats.ssr_evolved_to_lr, 0);
  assert.equal(Number(stats.profile_decision_packs_offset), 3);
  assert.equal((await rows("public.user_achievements")).length, 0);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.notifications where type='achievement_completed'"
      )
    ).rows[0].n,
    0
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(1)
  ]);
  // 9 Regular + one completed and one pending post-launch Decision Pack.
  assert.equal((await profile(id(1))).boostersOpened, 11);
  const achievements = (
    await db.query("select public.get_achievements() value")
  ).rows[0].value;
  assert.ok(
    achievements.every(a => a.completedAt === null && a.claimedAt === null)
  );
  assert.equal(
    achievements.find(a => a.conditionType === "regular_packs_opened")
      .progressCurrent,
    9
  );
  await assert.rejects(
    db.query(
      "update public.user_achievement_stats set profile_decision_packs_offset=0"
    ),
    /permission denied/
  );
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(2)
  ]);
  assert.equal(
    (await db.query("select public.get_decision_pack_status() value")).rows[0]
      .value.available,
    true
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query(
    "update public.user_achievement_stats set regular_packs_opened=regular_packs_opened+1 where user_id=$1",
    [id(1)]
  );
  await db.query(
    "select public.complete_achievements($1,array['regular_packs_opened'])",
    [id(1)]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(1)
  ]);
  assert.equal((await profile(id(1))).boostersOpened, 12);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  assert.equal(
    (
      await db.query(
        "select regular_packs_opened from public.user_achievement_stats where user_id=$1",
        [id(2)]
      )
    ).rows[0].regular_packs_opened,
    0
  );
  assert.equal(
    (
      await db.query(
        "select regular_packs_opened from public.user_achievement_stats where user_id=$1",
        [id(3)]
      )
    ).rows[0].regular_packs_opened,
    2
  );
  await assert.rejects(
    db.exec(resetLaunchProgressSQL(baseline, { commit: true })),
    /LAUNCH_PROGRESS_ALREADY_RESET/
  );
  await db.exec("rollback");
});

test("launch progress defaults to rollback and rejects inconsistent baselines or player JWTs atomically", async t => {
  const { db, baseline, rows } = await fixture(t);
  const tables = [
    "public.user_achievement_stats",
    "public.user_achievements",
    "public.notifications",
    "public.user_profiles"
  ];
  const before = await Promise.all(tables.map(rows));
  await db.exec(resetLaunchProgressSQL(baseline));
  assert.deepEqual(await Promise.all(tables.map(rows)), before);
  await assert.rejects(
    db.exec(
      resetLaunchProgressSQL([{ ...baseline[0], regular: 108 }, baseline[1]], {
        commit: true
      })
    ),
    /LAUNCH_PROGRESS_BASELINE_MISMATCH/
  );
  await db.exec("rollback");
  assert.deepEqual(await Promise.all(tables.map(rows)), before);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(1)
  ]);
  await assert.rejects(
    db.exec(resetLaunchProgressSQL(baseline, { commit: true })),
    /OPERATOR_CONNECTION_REQUIRED/
  );
  await db.exec("rollback");
  assert.deepEqual(await Promise.all(tables.map(rows)), before);
});

test("Decision Packs opened after preparation retain their cooldown and pending choices", async t => {
  const { db, baseline, rows } = await fixture(t);
  const profiles = await rows("public.user_profiles");
  await db.query(
    "insert into public.decision_packs(user_id,status) values($1,'pending')",
    [id(2)]
  );
  await db.exec(resetLaunchProgressSQL(baseline, { commit: true }));
  assert.deepEqual(await rows("public.user_profiles"), profiles);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.decision_packs where user_id=$1 and status='pending'",
        [id(2)]
      )
    ).rows[0].n,
    1
  );
});

test("launch progress rejects empty, duplicate, negative and injected manifests", () => {
  const row = {
    user_id: id(1),
    regular: 0,
    decision: 0,
    decisionOpened: 0,
    decisionEverOpened: 0,
    auctions: 0,
    trades: 0,
    evolved: 0
  };
  for (const input of [
    [],
    [row, row],
    [{ ...row, regular: -1 }],
    [{ ...row, user_id: "';select 1;--" }]
  ])
    assert.throws(() => resetLaunchProgressSQL(input), /snapshot baseline/);
});
