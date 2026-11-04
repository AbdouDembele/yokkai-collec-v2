import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261104170000_license_progress_score_cache.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);
const id = n => `97100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fn = "get_license_leaderboard";

test("stored license progress totals give exactly the live leaderboard, including after catalogue changes", async t => {
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
      [id(n), JSON.stringify({ pseudo: `Licensee${n}` })]
    );
  // Three licenses: A (3 cards), B (2 cards, other category), C (3 cards).
  const layout = [
    ["License A", "ANIME/MANGA", "C"],
    ["License A", "ANIME/MANGA", "R"],
    ["License A", "ANIME/MANGA", "SR"],
    ["License B", "FILM", "SSR"],
    ["License B", "FILM", "LR"],
    ["License C", "ANIME/MANGA", "C"],
    ["License C", "ANIME/MANGA", "LR"],
    ["License C", "ANIME/MANGA", "R"]
  ];
  const cards = [];
  const addCard = async (license, category, rarity) =>
    (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,$2,$3,$4,'https://example.test/card.png','test') returning id",
        [`license-cache-${cards.length}`, category, license, rarity]
      )
    ).rows[0].id;
  for (const entry of layout) cards.push(await addCard(...entry));
  const give = (owner, card, count = 1) =>
    db.query(
      `insert into public.user_cards(user_id,card_id,rarity)
       select $1,id,rarete_base from public.cards cross join generate_series(1,$3) where id=$2`,
      [id(owner), cards[card], count]
    );
  // 1 completes A and B, 2 completes A, 3 completes B, 4 and 6 tie, 5 is private.
  for (const card of [0, 1, 2, 3, 4]) await give(1, card, 2);
  for (const card of [0, 1, 2, 5]) await give(2, card);
  for (const card of [3, 4, 6]) await give(3, card);
  for (const card of [0, 5]) await give(4, card);
  for (const card of [0, 5]) await give(6, card, 3);
  for (const card of [1, 6, 7]) await give(5, card);
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(5)]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [id(1), id(2)]
  );

  // As in production, where this job runs every minute.
  await db.query("select public.refresh_catalogue_links_cache()");
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  const { rows: cron } = await db.query(
    "select schedule,command from cron.job where jobname='fold-license-score-changes'"
  );
  assert.deepEqual(cron, [
    {
      schedule: "* * * * *",
      command: "select public.fold_license_score_changes();"
    }
  ]);

  const call = async (viewer, args, name = fn) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(viewer)
    ]);
    return (await db.query(`select public.${name}($1,$2,$3,$4,$5) value`, args))
      .rows[0].value;
  };
  const compare = async label => {
    for (const viewer of [1, 2, 5, 7])
      for (const args of [
        ["global:progress-score", 0, 20, "", false],
        ["global:progress-score", 1, 2, "", false],
        ["global:progress-score", 0, 20, "licensee", false],
        ["global:progress-score", 0, 20, "3", false],
        ["global:progress-score", 0, 20, "", true],
        ["global:progress-score:legacy", 0, 20, "", false]
      ])
        assert.deepEqual(
          await call(viewer, args),
          await call(viewer, args, `reference_${fn}`),
          `${label} viewer ${viewer} ${JSON.stringify(args)}`
        );
  };
  const fold = () => db.query("select public.fold_license_score_changes()");
  const refreshLinks = () =>
    db.query("select public.refresh_catalogue_links_cache()");
  const pending = async () =>
    Number(
      (await db.query("select count(*) n from public.license_score_changes"))
        .rows[0].n
    );
  const cacheReady = async () =>
    (
      await db.query(
        `select s.version=s.built_version and st.links_version=s.built_version ready
         from public.catalogue_links_cache_state s, public.license_score_state st`
      )
    ).rows[0].ready;

  assert.equal(await cacheReady(), true, "fresh catalogue after migration");
  await compare("after migration");
  assert.equal(await pending(), 0, "initial totals need no log");

  // The stored totals are really read: a corrupted total shows up.
  await db.query(
    "update public.license_progress_scores set completion_score=completion_score+1000 where user_id=$1",
    [id(3)]
  );
  const args = ["global:progress-score", 0, 20, "", false];
  assert.notDeepEqual(
    await call(2, args),
    await call(2, args, `reference_${fn}`),
    "the cached path is used"
  );
  await db.query(
    "update public.license_progress_scores set completion_score=completion_score-1000 where user_id=$1",
    [id(3)]
  );

  await give(2, 3);
  await give(2, 4);
  await give(7, 7, 2);
  assert.ok((await pending()) > 0, "inserts are logged");
  await compare("pending inserts, scored live");
  await fold();
  assert.equal(await pending(), 0);
  await compare("after fold");

  await db.query(
    "update public.user_cards set user_id=$1 where id=(select id from public.user_cards where user_id=$2 and card_id=$3 limit 1)",
    [id(6), id(3), cards[6]]
  );
  await compare("pending transfer");
  await fold();
  await compare("after fold of transfer");

  await db.query(
    "update public.user_cards set is_locked=is_locked where user_id=$1",
    [id(4)]
  );
  assert.equal(await pending(), 0, "irrelevant updates are not logged");

  await db.query("update public.cards set rarete_base='SSR' where id=$1", [
    cards[5]
  ]);
  assert.ok((await pending()) > 0, "rarity changes are logged");
  await compare("pending rarity change");
  await fold();
  await compare("after fold of rarity change");

  // A new card in License B: completions change for everyone.
  cards.push(await addCard("License B", "FILM", "R"));
  assert.equal(await cacheReady(), false, "catalogue change disables totals");
  await compare("stale links cache, live path");
  await fold();
  assert.equal(await cacheReady(), false, "fold waits for the links cache");
  await refreshLinks();
  assert.equal(
    await cacheReady(),
    false,
    "totals still from the old catalogue"
  );
  await compare("fresh links, old totals, live path");
  await fold();
  assert.equal(await cacheReady(), true, "fold rebuilt every total");
  await compare("after rebuild");

  await db.query("delete from public.user_cards where user_id=$1", [id(1)]);
  await compare("pending deletion of a whole collection");
  await fold();
  await compare("after fold of deletion");
  assert.equal(
    (
      await db.query(
        "select count(*) n from public.license_progress_scores where user_id=$1",
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
    "select * from public.license_progress_scores",
    "select * from public.license_score_changes",
    "select * from public.license_score_state",
    "select * from public.license_progress_totals(null)",
    "select public.fold_license_score_changes()",
    `select public.license_progress_leaderboard_cached('${id(2)}',0,20,'',false)`
  ])
    await assert.rejects(() => db.query(sql), /permission denied/, sql);
  await db.exec("reset role");
});
