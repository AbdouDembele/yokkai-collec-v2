import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261104180000_binder_albums_totals.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);
const id = n => `97200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fn = "get_binder_albums_page";
const signature = "uuid,text,text,boolean,integer,integer";

test("stored binder totals give exactly the original binder list, fresh or stale", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(name => name.endsWith(".sql") && name < migration)
      .sort()
  });
  t.after(() => db.close());

  // Keep the current implementation as the reference.
  const definition = (
    await db.query(
      `select pg_get_functiondef('public.${fn}(${signature})'::regprocedure) d`
    )
  ).rows[0].d;
  await db.exec(definition.replace(`public.${fn}(`, `public.reference_${fn}(`));

  for (let n = 1; n <= 3; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: `Binder${n}` })]
    );
  const cards = [];
  const addCard = async (franchise, category, rarity, image = true) =>
    (
      await db.query(
        "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('test',$1,$1,$2,$3,$4,$5) returning id",
        [
          `albums-${cards.length}`,
          category,
          franchise,
          rarity,
          image ? `https://example.test/${cards.length}.png` : ""
        ]
      )
    ).rows[0].id;
  const layout = [
    ["Album A", "ANIME/MANGA", "C"],
    ["Album A", "ANIME/MANGA", "SR"],
    ["Album A", "ANIME/MANGA", "LR"],
    ["Album B", "FILM", "R"],
    ["Album B", "FILM", "SSR"],
    ["Album C", "ANIME/MANGA", "C", false],
    ["Album C", "ANIME/MANGA", "R"],
    ["Album D", "SPORT", "SR"]
  ];
  for (const entry of layout) cards.push(await addCard(...entry));
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values($1,'Album B',1)",
    [cards[0]]
  );
  const give = (owner, card, count = 1) =>
    db.query(
      `insert into public.user_cards(user_id,card_id,rarity)
       select $1,id,rarete_base from public.cards cross join generate_series(1,$3) where id=$2`,
      [id(owner), cards[card], count]
    );
  for (const card of [0, 1, 2, 3, 6]) await give(1, card, 2);
  for (const card of [0, 3, 4, 7]) await give(2, card);
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,'Album C'),($2,'Album A')",
    [id(1), id(2)]
  );

  await db.query("select public.refresh_catalogue_links_cache()");
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));

  const call = async (viewer, args, name = fn) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(viewer)
    ]);
    return (
      await db.query(`select public.${name}($1,$2,$3,$4,$5,$6) value`, args)
    ).rows[0].value;
  };
  const compare = async label => {
    for (const viewer of [1, 2, 3])
      for (const owner of [null, id(1), id(2)])
        for (const [query, category, favorites, offset, limit] of [
          ["", "", false, 0, 72],
          ["", "", false, 1, 2],
          ["", "", true, 0, 72],
          ["", "ANIME/MANGA", false, 0, 72],
          ["", "FILM,SPORT", false, 0, 72],
          ["album a", "", false, 0, 72],
          ["b", "FILM", false, 0, 72]
        ]) {
          const args = [owner, query, category, favorites, offset, limit];
          assert.deepEqual(
            await call(viewer, args),
            await call(viewer, args, `reference_${fn}`),
            `${label} viewer ${viewer} ${JSON.stringify(args)}`
          );
        }
  };

  const own = await call(1, [null, "", "", false, 0, 72]);
  assert.ok(own.items.length >= 4, "the fixture produces binders");
  assert.ok(
    own.items.some(item => item.owned > 0 && item.owned < item.total),
    "partial progress is exercised"
  );
  assert.ok(
    own.items.some(item => item.favorite),
    "a legacy favorite is exercised"
  );
  await compare("fresh links cache");
  const stored = Number(
    (
      await db.query(
        "select count(*) n from public.catalogue_binder_totals_cache"
      )
    ).rows[0].n
  );
  assert.ok(stored >= 4, "totals are stored");

  // The stored totals are really read without a category filter only.
  await db.query(
    "update public.catalogue_binder_totals_cache set total=total+100"
  );
  const unfiltered = [null, "", "", false, 0, 72];
  assert.notDeepEqual(
    await call(1, unfiltered),
    await call(1, unfiltered, `reference_${fn}`),
    "default view uses stored totals"
  );
  const filtered = [null, "", "ANIME/MANGA", false, 0, 72];
  assert.deepEqual(
    await call(1, filtered),
    await call(1, filtered, `reference_${fn}`),
    "category filter keeps the original computation"
  );
  await db.query(
    "update public.catalogue_binder_totals_cache set total=total-100"
  );

  // Catalogue change: stale cache, then rebuilt totals.
  cards.push(await addCard("Album A", "ANIME/MANGA", "SSR"));
  await give(2, cards.length - 1);
  await compare("stale links cache");
  await db.query("select public.refresh_catalogue_links_cache()");
  await compare("rebuilt links cache and totals");
  assert.equal(
    (
      await db.query(
        `select (select total from public.catalogue_binder_totals_cache c
           where c.binder_key=(select binder_key from public.catalogue_binder_links_cache
             where card_id=$1 limit 1)) total`,
        [cards.at(-1)]
      )
    ).rows[0].total,
    4,
    "Album A has four cards after the rebuild"
  );

  // Players cannot read the new cache or view.
  await db.exec("set role authenticated");
  for (const sql of [
    "select * from public.catalogue_binder_totals_cache",
    "select * from public.catalogue_binder_totals",
    "select * from public.catalogue_binder_names_cache",
    "select * from public.catalogue_binder_names"
  ])
    await assert.rejects(() => db.query(sql), /permission denied/, sql);
  await db.exec("reset role");
});
