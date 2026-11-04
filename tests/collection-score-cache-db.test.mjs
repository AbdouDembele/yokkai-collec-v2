import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261104130000_collection_score_cache.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);
const id = n => `97000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fn = "leaderboard_collection_without_styles";

test("stored collection scores give exactly the live leaderboard, before and after each fold", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(name => name.endsWith(".sql") && name < migration)
      .sort()
  });
  t.after(() => db.close());

  // Keep the current implementation as the reference.
  const definition = (
    await db.query(
      "select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",
      [fn]
    )
  ).rows[0].d;
  await db.exec(definition.replace(`public.${fn}(`, `public.reference_${fn}(`));

  for (let n = 1; n <= 7; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: `Scorer${n}` })]
    );
  const cards = [];
  for (const [n, rarity] of ["C", "R", "SR", "SSR", "LR", "LR"].entries())
    cards.push(
      (
        await db.query(
          "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA',$2,'https://example.test/card.png','test') returning id",
          [`score-cache-${n}`, rarity]
        )
      ).rows[0].id
    );
  const give = (owner, card, count = 1, shiny = false, evolved = false) =>
    db.query(
      `insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved)
       select $1,id,rarete_base,$3,$4 from public.cards cross join generate_series(1,$5) where id=$2`,
      [id(owner), cards[card], shiny, evolved, count]
    );
  for (let owner = 1; owner <= 6; owner++)
    for (let card = 0; card < 6; card++)
      if ((owner + card) % 3 !== 0) await give(owner, card, owner);
  await give(2, 3, 1, true, false);
  await give(3, 4, 2, false, true);
  await give(4, 5, 1, true, false);
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(5)]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [id(1), id(2)]
  );

  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  const { rows: cron } = await db.query(
    "select schedule,command from cron.job where jobname='fold-collection-score-changes'"
  );
  assert.deepEqual(cron, [
    {
      schedule: "* * * * *",
      command: "select public.fold_collection_score_changes();"
    }
  ]);

  const compare = async label => {
    for (const viewer of [1, 2, 5, 7])
      for (const args of [
        [0, 20, "", false],
        [1, 2, "", false],
        [0, 20, "scorer", false],
        [0, 20, "3", false],
        [0, 20, "", true]
      ]) {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          id(viewer)
        ]);
        const { rows } = await db.query(
          `select public.${fn}($1,$2,$3,$4) value, public.reference_${fn}($1,$2,$3,$4) reference`,
          args
        );
        assert.deepEqual(
          rows[0].value,
          rows[0].reference,
          `${label} viewer ${viewer} ${JSON.stringify(args)}`
        );
      }
  };
  const fold = () => db.query("select public.fold_collection_score_changes()");
  const pending = async () =>
    Number(
      (await db.query("select count(*) n from public.collection_score_changes"))
        .rows[0].n
    );

  await compare("after migration");
  assert.equal(await pending(), 0, "initial scores need no log");

  await give(1, 5, 3, true, false);
  await give(7, 4, 1);
  assert.ok((await pending()) > 0, "inserts are logged");
  await compare("pending inserts, scored live");
  await fold();
  assert.equal(await pending(), 0);
  await compare("after fold");

  await db.query(
    "update public.user_cards set is_shiny=true where id=(select id from public.user_cards where user_id=$1 and card_id=$2 and not is_shiny limit 1)",
    [id(2), cards[3]]
  );
  await db.query(
    "update public.user_cards set user_id=$1 where id=(select id from public.user_cards where user_id=$2 and card_id=$3 limit 1)",
    [id(6), id(3), cards[4]]
  );
  await compare("pending updates and transfer");
  await fold();
  await compare("after fold of updates");

  await db.query(
    "update public.user_cards set is_locked=is_locked where user_id=$1",
    [id(4)]
  );
  assert.equal(await pending(), 0, "irrelevant updates are not logged");

  await db.query("update public.cards set rarete_base='SSR' where id=$1", [
    cards[5]
  ]);
  await compare("pending rarity change");
  await fold();
  await compare("after fold of rarity change");

  await db.query("delete from public.user_cards where user_id=$1", [id(1)]);
  await compare("pending deletion of a whole collection");
  await fold();
  await compare("after fold of deletion");
  assert.equal(
    (
      await db.query(
        "select count(*) n from public.collection_scores where user_id=$1",
        [id(1)]
      )
    ).rows[0].n,
    0
  );

  // Players cannot read or write the score tables, nor call the helpers.
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(2)
  ]);
  for (const sql of [
    "select * from public.collection_scores",
    "select * from public.collection_score_changes",
    "select * from public.collection_score_totals(null)",
    "select public.fold_collection_score_changes()"
  ])
    await assert.rejects(() => db.query(sql), /permission denied/, sql);
  await db.exec("reset role");
});
