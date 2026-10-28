// Disposable PGlite only. Never connects to Supabase or modifies production.
// node scripts/benchmark-pack-performance.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { replayMigrations } from "./replay-migrations.mjs";

const directory = new URL("../supabase/migrations/", import.meta.url);
const migration = "20261009000012_pack_achievement_performance.sql";
const sizes = [0, 3000, 10000, 30000];
const { db } = await replayMigrations({
  migrations: readdirSync(directory)
    .filter(n => n.endsWith(".sql") && n !== migration)
    .sort()
});
try {
  await db.exec(`insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select md5('bench-card-'||g)::uuid,'bench-'||g,'Bench '||g,'Category '||((g-1)%10),'Bench',
      (array['C','R','SR','SSR','LR'])[1+(g-1)%5]::public.card_rarity,'https://example.test/card.png','test'
    from generate_series(1,20000) g;`);
  const players = [];
  for (const size of sizes) {
    const id = (
      await db.query("select md5($1)::uuid as id", [`bench-player-${size}`])
    ).rows[0].id;
    players.push(id);
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `Bench${size}` })]
    );
    // Fixture loading is outside measured RPCs. Re-enable the original trigger
    // before every measurement; no constraint or other gameplay trigger disabled.
    await db.exec(
      "alter table public.user_cards disable trigger user_cards_acquired_achievements"
    );
    await db.query(
      `insert into public.user_cards(user_id,card_id,rarity,is_shiny)
      select $1,c.id,c.rarete_base,g%100=0 from generate_series(1,$2) g
      join public.cards c on c.id=md5('bench-card-'||(1+(g-1)%20000))::uuid`,
      [id, size]
    );
    await db.exec(
      "alter table public.user_cards enable trigger user_cards_acquired_achievements"
    );
  }
  await db.exec("analyze public.cards; analyze public.user_cards");
  async function measure() {
    const results = [];
    for (const [i, size] of sizes.entries()) {
      const samples = [];
      let draws;
      for (let trial = 0; trial < 6; trial++) {
        await db.exec("begin; select setseed(0.271828)");
        try {
          await db.query(
            "update public.user_profiles set next_regular_pack_at=now()-interval '1 hour' where user_id=$1",
            [players[i]]
          );
          await db.exec("set role authenticated");
          await db.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [players[i]]
          );
          const start = performance.now();
          const pack = (
            await db.query("select public.open_regular_pack() as result")
          ).rows[0].result;
          const ms = performance.now() - start;
          assert.equal(pack.length, 5);
          const signature = pack.map(({ id, rarity, shiny }) => ({
            id,
            rarity,
            shiny
          }));
          if (draws) assert.deepEqual(signature, draws);
          draws = signature;
          if (trial > 0) samples.push(ms); // warmup excluded; rollback keeps identical collection size
        } finally {
          await db.exec("rollback; reset role");
        }
      }
      const median = [...samples].sort((a, b) => a - b)[2];
      results.push({
        collectionCards: size,
        medianMs: Number(median.toFixed(2)),
        samplesMs: samples.map(x => Number(x.toFixed(2))),
        draws
      });
    }
    return results;
  }
  const before = await measure();
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  const after = await measure();
  for (const [i, result] of before.entries())
    assert.deepEqual(after[i].draws, result.draws);
  console.log(
    JSON.stringify(
      {
        engine: (await db.query("select version() as version")).rows[0].version,
        catalogueCards: 20000,
        trials: 5,
        warmup: 1,
        seededDraws: true,
        before,
        after,
        reduction: before.map((r, i) => ({
          collectionCards: r.collectionCards,
          percent: Number(
            (100 * (1 - after[i].medianMs / r.medianMs)).toFixed(1)
          )
        }))
      },
      null,
      2
    )
  );
} finally {
  await db.close();
}
