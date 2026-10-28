import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const sql = readFileSync(
  new URL(
    "../supabase/recipes/merge_dragon_ball_z_20261025.sql",
    import.meta.url
  ),
  "utf8"
);
const root = "308dee4e-c046-5b13-a089-4b2a83806107";
const z = "436a5768-c482-5a8c-a337-71323ad1909a";
const superId = "dc105838-4e76-593a-ae47-22f82ad74130";
const player = "dba00000-0000-4000-8000-000000000001";
const id = i => `dbb00000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const films = [
  "Dragon Ball Z: The Tree of Might",
  "Dragon Ball Z: Resurrection 'F'",
  "Dragon Ball Z: Lord Slug",
  "Dragon Ball Z: The Return of Cooler",
  "Dragon Ball Z: Wrath of the Dragon",
  "Dragon Ball Z: Bio-Broly"
];
const sourceKey = (title, category = "ANIME/MANGA") =>
  "source:" +
  createHash("sha256")
    .update(category + "\u001f" + title)
    .digest("hex");
const all = async (db, table) =>
  (
    await db.query(
      `select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`
    )
  ).rows;
const value = async (db, query, args = []) =>
  (await db.query(query, args)).rows[0].value;

async function setup() {
  const { db } = await replayMigrations();
  await db.exec("set time zone 'UTC'");
  await db.exec(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true,mapping_version='11d454c073cf2c60d31c6d34452ad621501f17875d2d1aa906f6ebb337ed7b88',license_mapping_version='c3a54b282cd883e7325fee120b7c736f6dbd576fc140aab07b4c0f36508e7490'"
  );
  for (const [index, [binder, title]] of [
    [root, "Dragon Ball"],
    [z, "Dragon Ball Z"],
    [superId, "Dragon Ball Super"]
  ].entries()) {
    await db.query("insert into public.anime_series_binders values($1,$2,$3)", [
      binder,
      900000 + index,
      title
    ]);
    await db.query("insert into public.anime_license_binders values($1,$2)", [
      binder,
      title
    ]);
  }
  for (const [title, binder] of [
    ...films.map(title => [title, z]),
    ["Dragon Ball", root],
    ["Dragon Ball Z: Battle of Gods", z],
    ["Dragon Ball Super", superId]
  ]) {
    await db.query(
      "insert into public.anime_license_source_rules values($1,$2)",
      [title, binder]
    );
    await db.query("insert into public.anime_license_aliases values($1,$2)", [
      binder,
      title
    ]);
    await db.query(
      "insert into public.anime_license_key_redirects values($1,$2)",
      [sourceKey(title), binder]
    );
  }
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"DragonFilms"}\')',
    [player]
  );
  const add = async (i, title, category = "ANIME/MANGA") =>
    db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,'Character',$3,$4,'SR','https://example.test/dragon.png',$5)",
      [id(i), String(9000 + i), category, title, i === 1 ? "anilist" : "manual"]
    );
  for (let i = 0; i < films.length; i++) await add(i + 1, films[i]);
  await add(7, "Dragon Ball");
  await add(8, "Dragon Ball Z: Battle of Gods");
  await add(9, "Dragon Ball Super");
  await add(10, null);
  await add(11, films[0], "VIDEO GAMES");
  await db.query(
    "insert into public.card_franchises values($1,$2,1),($3,$4,2),($3,'Unrelated license',4)",
    [id(7), films[0], id(10), films[2]]
  );
  await db.query(
    "insert into public.anime_series_media_rules values(896,$1,'A',true)",
    [z]
  );
  await db.query(
    "insert into public.anime_license_media_rules values(896,$1,false)",
    [z]
  );
  await db.query(
    "insert into public.anime_series_origin_evidence(card_id,character_id,media_id,verified_snapshot,import_evidence_sha256) select id,9001,896,to_jsonb(cards),repeat('a',64) from public.cards where id=$1",
    [id(1)]
  );
  await db.query(
    "insert into public.anime_series_card_assignments values($1,$2,896)",
    [id(1), films[0]]
  );
  return { db, add };
}

test("all Dragon Ball Z cards join Dragon Ball; sources, proofs, copies, favorites and unrelated binders survive", async t => {
  const { db, add } = await setup();
  t.after(() => db.close());
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'C'),($1,$2,'SR')",
    [player, id(1)]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values($1,$2)",
    [player, id(2)]
  );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,$2)",
    [player, films[0]]
  );
  await db.query(
    "insert into public.binder_favorite_preferences(user_id,binder_key,favorite) values($1,$2,true),($1,$3,true)",
    [player, sourceKey(films[5]), "series:" + z]
  );
  const widgets = [
    {
      category: "ANIME/MANGA",
      entries: [films[0], sourceKey(films[1]), "series:" + z]
    }
  ];
  await db.query(
    "update public.user_profiles set profile_widgets=$2 where user_id=$1",
    [player, JSON.stringify(widgets)]
  );
  const tables = [
    "cards",
    "card_franchises",
    "user_cards",
    "wishlists",
    "user_profiles",
    "panini_album_favorites",
    "binder_favorite_preferences",
    "anime_series_origin_evidence",
    "anime_series_card_assignments",
    "anime_series_media_rules",
    "anime_license_media_rules",
    "anime_license_source_rules",
    "anime_license_aliases",
    "anime_license_key_redirects"
  ];
  const before = Object.fromEntries(
    await Promise.all(tables.map(async table => [table, await all(db, table)]))
  );
  await db.exec(sql);
  for (const table of tables)
    assert.deepEqual(await all(db, table), before[table], table + " unchanged");
  assert.deepEqual(await all(db, "catalogue_binder_groups"), [
    { row: { id: root, display_name: "Dragon Ball", enabled: true } }
  ]);
  assert.deepEqual(await all(db, "catalogue_binder_group_merges"), [
    {
      row: {
        old_key: "series:" + z,
        group_id: root,
        category: null,
        source_license: null
      }
    }
  ]);
  const links = (await db.query("select * from public.catalogue_binder_links"))
    .rows;
  for (let i = 1; i <= 7; i++)
    assert.equal(
      links.find(row => row.card_id === id(i)).binder_key,
      "series:" + root
    );
  assert.equal(
    links.find(row => row.card_id === id(8)).binder_key,
    "series:" + root
  );
  assert.equal(
    links.find(row => row.card_id === id(9)).binder_key,
    "series:" + superId
  );
  assert.equal(
    links.find(row => row.card_id === id(10) && row.source_license === films[2])
      .binder_key,
    "series:" + root
  );
  assert.equal(
    links.find(row => row.card_id === id(11)).binder_key,
    sourceKey(films[0], "VIDEO GAMES")
  );
  for (const title of films)
    assert.equal(
      await value(db, "select public.canonical_binder_key($1) value", [
        sourceKey(title)
      ]),
      "series:" + root
    );
  assert.equal(
    await value(db, "select public.canonical_binder_key($1) value", [
      "series:" + z
    ]),
    "series:" + root
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  const albums = await value(
    db,
    "select public.get_binder_albums_page(null,'Tree of Might','ANIME/MANGA',false,0,72) value"
  );
  assert.equal(albums.total, 1);
  assert.equal(albums.items[0].license, "Dragon Ball");
  assert.equal(albums.items[0].total, 9);
  assert.equal(albums.items[0].owned, 1);
  assert.equal(albums.items[0].favorite, true);
  const zCards = await value(
    db,
    "select public.get_binder_cards_page(null,$1,'','ANIME/MANGA','',false,0,60,'rarity') value",
    ["series:" + z]
  );
  assert.equal(zCards.total, 9);
  assert(zCards.items.some(card => card.id === id(8)));
  assert.equal(new Set(zCards.items.map(card => card.id)).size, 9);
  const oldSourceCards = await value(
    db,
    "select public.get_binder_cards_page(null,$1,'','ANIME/MANGA','',false,0,60,'rarity') value",
    [sourceKey(films[5])]
  );
  assert.equal(oldSourceCards.total, 9);
  const catalogue = await value(
    db,
    "select public.get_binder_catalogue_page('Tree of Might','ANIME/MANGA','',0,60) value"
  );
  assert.equal(catalogue.total, 9);
  const profile = await value(
    db,
    "select public.get_profile_details_with_binders(null) value"
  );
  assert.deepEqual(profile.widgets[0].entries, ["series:" + root]);
  assert(
    profile.favoriteAlbums.some(album => album.binderKey === "series:" + root)
  );
  assert(
    !profile.favoriteAlbums.some(album => album.binderKey === "series:" + z)
  );
  await db.exec("reset role");
  const configured = await all(db, "anime_license_source_rules");
  const editorial = await all(db, "catalogue_binder_group_merges");
  await db.exec(sql);
  assert.deepEqual(await all(db, "anime_license_source_rules"), configured);
  assert.deepEqual(await all(db, "catalogue_binder_group_merges"), editorial);
  await add(12, films[5]);
  assert.equal(
    (
      await db.query(
        "select binder_key from public.catalogue_binder_links where card_id=$1",
        [id(12)]
      )
    ).rows[0].binder_key,
    "series:" + root
  );
  await add(13, "Dragon Ball Z: Battle of Gods");
  assert.equal(
    (
      await db.query(
        "select binder_key from public.catalogue_binder_links where card_id=$1",
        [id(13)]
      )
    ).rows[0].binder_key,
    "series:" + root
  );
});

test("an incompatible source route aborts without rewriting any routing or player data", async t => {
  const { db } = await setup();
  t.after(() => db.close());
  await db.query(
    "update public.anime_license_source_rules set binder_id=$2 where source_license=$1",
    [films[0], superId]
  );
  const before = await all(db, "anime_license_source_rules");
  const cards = await all(db, "cards");
  const aliases = await all(db, "anime_license_aliases");
  await assert.rejects(db.exec(sql), /DRAGON_BALL_SOURCE_RULE_CHANGED/);
  await db.exec("rollback");
  assert.deepEqual(await all(db, "anime_license_source_rules"), before);
  assert.deepEqual(await all(db, "cards"), cards);
  assert.deepEqual(await all(db, "anime_license_aliases"), aliases);
});
