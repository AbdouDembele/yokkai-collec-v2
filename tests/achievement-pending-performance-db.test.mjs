import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = "10000000-0000-4000-8000-000000000009";

test("completed achievements never rescan collection during a regular pack", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"PendingPerf"}\')',
    [player]
  );
  await db.exec(`
    insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select md5('pending-'||g)::uuid,'pending-'||g,'Card '||g,'Fixture','Fixture',
      (array['C','R','SR','SSR','LR'])[1+(g-1)%5]::public.card_rarity,'https://example.test/card.png','test'
    from generate_series(1,20000) g;
  `);
  await db.query(
    `insert into public.user_cards(user_id,card_id,rarity,is_shiny)
    select $1,md5('pending-'||(1+(g-1)%20000))::uuid,
      (array['C','R','SR','SSR','LR'])[1+(g-1)%5]::public.card_rarity,g=5
    from generate_series(1,30000) g`,
    [player]
  );
  // All collection conditions were completed by the real acquisition trigger.
  const original = (
    await db.query(
      "select pg_get_functiondef('public.achievement_progress(uuid,text)'::regprocedure) as def"
    )
  ).rows[0].def;
  // Preserve STABLE semantics: a sequence records calls without changing query results.
  await db.exec(
    "create sequence public.pending_perf_calls_seq minvalue 0 start 0"
  );
  await db.exec(
    original.replace(
      /\bbegin\b/i,
      "begin if p_condition_type in ('unique_cards_collected','first_lr_card','shiny_cards_collected','cards_collected_category_percent') then perform nextval('public.pending_perf_calls_seq'); end if;"
    )
  );
  await db.exec("begin; set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      player
    ]);
    await db.query("select public.open_regular_pack()");
  } finally {
    await db.exec("rollback; reset role");
  }
  const calls = (
    await db.query("select is_called from public.pending_perf_calls_seq")
  ).rows[0].is_called;
  // Only the still-pending regular-pack condition may be evaluated.
  assert.equal(
    calls,
    false,
    "collection conditions already completed must not invoke achievement_progress"
  );
  // Missing rows and existing NULL completions must still cross their threshold.
  await db.query(
    "delete from public.user_achievements where user_id=$1 and achievement_id='collection-en-marche'",
    [player]
  );
  await db.query(
    "update public.user_achievements set completed_at=null where user_id=$1 and achievement_id='specialiste'",
    [player]
  );
  await db.query(
    "select public.complete_achievements($1,array['unique_cards_collected','cards_collected_category_percent','auctions_won'])",
    [player]
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from public.user_achievements where user_id=$1 and achievement_id in ('collection-en-marche','specialiste') and completed_at is not null",
          [player]
        )
      ).rows[0].count
    ),
    2
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from public.user_achievements where user_id=$1 and achievement_id='adjuge' and completed_at is not null",
          [player]
        )
      ).rows[0].count
    ),
    0
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from public.notifications where user_id=$1 and type='achievement_completed' and achievement_id in ('collection-en-marche','specialiste')",
          [player]
        )
      ).rows[0].count
    ),
    2
  );
});
