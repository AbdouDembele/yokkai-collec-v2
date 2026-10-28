// Disposable PGlite only. Run serially: node scripts/profile-achievements.mjs <report.md>
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { replayMigrations } from "./replay-migrations.mjs";

const directory = new URL("../supabase/migrations/", import.meta.url);
const migration = "20261019030001_pending_achievement_evaluation.sql";
const player = "10000000-0000-4000-8000-000000000009";
const types =
  "array['unique_cards_collected','first_lr_card','shiny_cards_collected','cards_collected_category_percent']";
const { db } = await replayMigrations({
  migrations: readdirSync(directory)
    .filter(n => n.endsWith(".sql") && n !== migration)
    .sort()
});
const report = [
  "# PERF-09: reproducible PGlite profile",
  "",
  "Reproduce: `node scripts/profile-achievements.mjs docs/audits/PERF-09-profile.md` (Node 22, locked dependencies). The script replays all migrations except the candidate, measures, then applies it to the same disposable database. No remote database is used.",
  "",
  "20,000 catalogue cards, five balanced rarities, one category; exactly 30,000 copies / 20,000 distinct cards. Real triggers enabled. Each authenticated RPC uses the same seed and is rolled back. One warm-up, eight samples per state. Timings cover only open_regular_pack, excluding snapshots and EXPLAIN. EXPLAIN runs the actual completion function body and the four inner progress queries as the database owner (matching SECURITY DEFINER). PGlite/Windows timings are not PostgreSQL 17 production latency; no comparison with the audit's separate run is claimed.",
  "",
  "Only completion evaluation changes. Live progress queries below deliberately retain their original plans and cost. Pending collection conditions still scan; completed conditions are removed before progress evaluation. No counters, indexes, API or player text changes. Migration: 20261019030001_pending_achievement_evaluation.sql — non appliquée sur le VPS."
];

async function sample() {
  await db.exec("begin; select setseed(0.314159); set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      player
    ]);
    const start = performance.now();
    const cards = (await db.query("select public.open_regular_pack() as cards"))
      .rows[0].cards;
    const ms = performance.now() - start;
    await db.exec("reset role");
    const state = (
      await db.query(
        `select jsonb_build_object(
      'progress',(select jsonb_object_agg(condition_type,public.achievement_progress($1,condition_type))
        from (select distinct condition_type from public.achievements) a),
      'completed',(select jsonb_agg(jsonb_build_array(achievement_id,completed_at is not null,claimed_at is not null) order by achievement_id)
        from public.user_achievements where user_id=$1),
      'notifications',(select jsonb_agg(achievement_id order by achievement_id)
        from public.notifications where user_id=$1 and type='achievement_completed'),
      'stats',(select to_jsonb(s) from public.user_achievement_stats s where user_id=$1)
    ) as state`,
        [player]
      )
    ).rows[0].state;
    return { ms, state, cards: cards.map(c => [c.id, c.rarity, c.shiny]) };
  } finally {
    await db.exec("rollback; reset role");
  }
}

async function profile(label) {
  const warmup = await sample();
  const times = [];
  for (let i = 0; i < 8; i++) times.push((await sample()).ms);
  const sorted = [...times].sort((a, b) => a - b);
  report.push(
    `\n## ${label}`,
    `\nMedian: **${((sorted[3] + sorted[4]) / 2).toFixed(2)} ms**. Samples (ms): ${times.map(n => n.toFixed(2)).join(", ")}.`
  );
  const def = (
    await db.query(
      "select pg_get_functiondef('public.complete_achievements(uuid,text[])'::regprocedure) as def"
    )
  ).rows[0].def;
  const completion = def
    .slice(def.indexOf("begin") + 5, def.lastIndexOf("end;"))
    .replaceAll("p_user_id", `'${player}'::uuid`)
    .replaceAll("p_condition_types", types);
  const queries = {
    unique: `select count(distinct card_id) from public.user_cards where user_id='${player}'`,
    lr: `select exists(select 1 from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.user_id='${player}' and c.rarete_base='LR')`,
    shiny: `select count(*) from public.user_cards where user_id='${player}' and is_shiny`,
    category: `select coalesce(max(floor(100.0*owned/total)::integer),0) from (
      select c.categorie,count(distinct uc.card_id) as owned,count(distinct c.id) as total
      from public.cards c left join public.user_cards uc on uc.card_id=c.id and uc.user_id='${player}'
      where c.categorie is not null group by c.categorie) p where total>0`,
    complete_achievements: completion
  };
  for (const [name, sql] of Object.entries(queries)) {
    await db.exec("begin");
    try {
      const plan = await db.query(`explain (analyze,buffers) ${sql}`);
      report.push(
        `\n### ${name}\n\n\`\`\`text`,
        ...plan.rows.map(r => r["QUERY PLAN"]),
        "```"
      );
    } finally {
      await db.exec("rollback");
    }
  }
  return warmup;
}

try {
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"ProfilePerf"}\')',
    [player]
  );
  await db.exec(`insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select md5('pending-'||g)::uuid,'pending-'||g,'Card '||g,'Fixture','Fixture',
      (array['C','R','SR','SSR','LR'])[1+(g-1)%5]::public.card_rarity,'https://example.test/card.png','test'
    from generate_series(1,20000) g`);
  await db.query(
    `insert into public.user_cards(user_id,card_id,rarity)
    select $1,md5('pending-'||(1+(g-1)%20000))::uuid,
      (array['C','R','SR','SSR','LR'])[1+(g-1)%5]::public.card_rarity
    from generate_series(1,30000) g`,
    [player]
  );
  await db.exec(
    "analyze public.cards; analyze public.user_cards; analyze public.user_achievements; analyze public.achievements"
  );
  const before = await profile("Before — Shiny achievement pending");
  if (existsSync(new URL(migration, directory))) {
    const baseline = (
      await db.query(
        "select pg_get_functiondef('public.complete_achievements(uuid,text[])'::regprocedure) as def"
      )
    ).rows[0].def;
    await db.exec(readFileSync(new URL(migration, directory), "utf8"));
    const after = await profile("After — Shiny achievement pending");
    assert.deepEqual(after.state, before.state);
    assert.deepEqual(after.cards, before.cards);
    // Same 30,000-copy fixture, with its one remaining collection condition completed.
    await db.query(
      "update public.user_cards set is_shiny=true where id=(select id from public.user_cards where user_id=$1 and rarity='LR' limit 1)",
      [player]
    );
    await db.query(
      "select public.complete_achievements($1,array['shiny_cards_collected'])",
      [player]
    );
    await db.exec(baseline);
    const completedBefore = await profile(
      "Before — all collection achievements completed"
    );
    await db.exec(readFileSync(new URL(migration, directory), "utf8"));
    const completedAfter = await profile(
      "After — all collection achievements completed"
    );
    assert.deepEqual(completedAfter.state, completedBefore.state);
    assert.deepEqual(completedAfter.cards, completedBefore.cards);
    report.push(
      "\nBefore/after pack contents, live progress, completed/claimed states, notifications and counters: identical."
    );
  }
  writeFileSync(
    process.argv[2] ?? "perf-09-profile.md",
    report.join("\n") + "\n"
  );
  console.log(report.filter(line => line.startsWith("\nMedian:")).join("\n"));
} finally {
  await db.close();
}
