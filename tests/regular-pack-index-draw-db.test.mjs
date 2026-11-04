import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261104160000_regular_pack_index_draw.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);
const player = "f9500000-0000-4000-8000-000000000001";

test("indexed Regular draw returns exactly the same cards for the same rolls", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(name => name.endsWith(".sql") && name < migration)
      .sort()
  });
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"Index Draw"}\')',
    [player]
  );
  // Uneven pools so offsets land everywhere, including LR shiny rolls.
  await db.exec(`insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select 'draw-'||g,'Draw '||g,'ANIME/MANGA','Draw',
      (case when g<=60 then 'C' when g<=90 then 'R' when g<=105 then 'SR' when g<=112 then 'SSR' else 'LR' end)::public.card_rarity,
      'https://example.test/card.png','test'
    from generate_series(1,118) g`);

  const definition = (
    await db.query(
      "select pg_get_functiondef('public.open_regular_pack()'::regprocedure) d"
    )
  ).rows[0].d;
  const before = (
    await db.query(
      "select proacl::text, prosecdef, provolatile, proconfig from pg_proc where oid='public.open_regular_pack()'::regprocedure"
    )
  ).rows;
  await db.exec(
    definition.replace(
      "public.open_regular_pack()",
      "public.reference_open_regular_pack()"
    )
  );
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual(
    (
      await db.query(
        "select proacl::text, prosecdef, provolatile, proconfig from pg_proc where oid='public.open_regular_pack()'::regprocedure"
      )
    ).rows,
    before,
    "no grant, security or volatility change"
  );
  const patched = (
    await db.query(
      "select pg_get_functiondef('public.open_regular_pack()'::regprocedure) d"
    )
  ).rows[0].d;
  assert.notEqual(patched, definition);
  assert.equal(
    patched
      .replace(
        /where id=\(\n\s+select pool\.id from public\.cards pool where pool\.rarete_base=/,
        "where rarete_base="
      )
      .replace(
        "order by pool.id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1);",
        "order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;"
      ),
    definition,
    "only the draw statement changes"
  );

  const draw = async (fn, seed, opened) => {
    await db.exec("begin");
    try {
      await db.query(
        "update public.user_profiles set next_regular_pack_at=now()-interval '1 hour', bonus_regular_packs=0 where user_id=$1",
        [player]
      );
      await db.query(
        "insert into public.user_achievement_stats(user_id) values($1) on conflict do nothing",
        [player]
      );
      await db.query(
        "update public.user_achievement_stats set regular_packs_opened=$2 where user_id=$1",
        [player, opened]
      );
      await db.query("select setseed($1)", [seed]);
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        player
      ]);
      const result = (await db.query(`select public.${fn}() r`)).rows[0].r;
      return result.map(card => [card.id, card.rarity, card.shiny]);
    } finally {
      await db.exec("rollback");
    }
  };
  for (let i = 0; i < 40; i++) {
    const seed = ((i * 37) % 97) / 97 - 0.5;
    const opened = i % 2 ? 3 : 20; // with and without the new-player boost
    const reference = await draw("reference_open_regular_pack", seed, opened);
    assert.equal(reference.length, 5);
    assert.deepEqual(
      await draw("open_regular_pack", seed, opened),
      reference,
      `seed ${seed}`
    );
  }
});
