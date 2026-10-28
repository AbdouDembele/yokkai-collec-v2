import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import { transactionBody } from "../scripts/plan-deploy-migrations.mjs";

const recipe = readFileSync(
  new URL(
    "../supabase/recipes/correct_persona_mob_binders_20261026.sql",
    import.meta.url
  ),
  "utf8"
);
const igor = "4a05bda1-0d64-4bb0-9e48-8e1aa59bb68b";
const mob = "0e81eeec-23bc-5c7a-a941-d376b34c90d1";
const oldMob =
  "source:5d166f7c57a212736437d952fd9720f31999387c9be518824fd2bd1de737bb4b";
const oldPersona =
  "source:a4e4118ef0a592e2caa54d16bff3bd7a20aaca287b1078de072917890e83912f";
const owner = "99000000-0000-4000-8000-000000000001";
const id = n => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rows = async (db, table) =>
  (
    await db.query(
      `select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`
    )
  ).rows;
async function fixture(t) {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [owner, JSON.stringify({ pseudo: "BinderOwner" })]
  );
  await db.query(
    "insert into public.anime_series_binders values($1,21507,'Mob Psycho 100')",
    [mob]
  );
  await db.query(
    "insert into public.anime_license_binders values($1,'Mob Psycho 100')",
    [mob]
  );
  await db.query(
    "insert into public.anime_license_source_rules values('Mob Psycho 100',$1)",
    [mob]
  );
  await db.exec(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true,mapping_version='11d454c073cf2c60d31c6d34452ad621501f17875d2d1aa906f6ebb337ed7b88',license_mapping_version='71c6fc67af55d11c1a390cdbba4443093498cbda896e43a49bc9a3b074c6291c'"
  );
  const add = async (card, name, category, license, sourceId = card) =>
    db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,$3,$4,$5,'SR','https://example.test/kept.png','manual')",
      [card, sourceId, name, category, license]
    );
  await add(
    igor,
    "IGOR",
    "ANIME/MANGA",
    "Persona 5",
    "manual-71cb0d13ba9c828c15a454fc"
  );
  await db.query(
    "insert into public.card_franchises values($1,'PERSONA 3',1)",
    [igor]
  );
  await add(id(10), "JOKER", "VIDEO GAMES", "Persona 5");
  await add(id(11), "MAKOTO", "VIDEO GAMES", "PERSONA 3");
  await add(id(20), "MOB", "ANIME/MANGA", "Mob Psycho 100");
  await add(id(21), "NIIDO", "ANIME/MANGA", "Mob Psycho 100 I");
  await add(id(22), "SAKURE", "ANIME/MANGA", "Mob Psycho 100 I");
  await db.query(
    "insert into public.card_franchises values($1,'Mob Psycho 100',1)",
    [id(21)]
  );
  for (const [n, license] of [
    "Fate/stay night",
    "Fate/stay night: Unlimited Blade Works",
    "Fate/Zero",
    "Fate/Grand Order CMs",
    "Fate Rewinder",
    "Ox Tales"
  ].entries())
    await add(id(30 + n), n === 5 ? "IGOR" : "OTHER", "ANIME/MANGA", license);
  await db.query(
    "insert into public.user_cards(id,user_id,card_id,rarity,is_locked,custom_image_url) values($1,$2,$3,'SR',true,'https://i.imgur.com/custom.png')",
    [id(50), owner, igor]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values($1,$2),($1,$3)",
    [owner, igor, id(21)]
  );
  await db.query(
    "insert into public.binder_favorite_preferences(user_id,binder_key,favorite,license_favorite) values($1,$2,true,true)",
    [owner, oldMob]
  );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,'Mob Psycho 100 I')",
    [owner]
  );
  await db.query(
    "update public.user_profiles set profile_widgets=$2 where user_id=$1",
    [owner, JSON.stringify([{ category: "ANIME/MANGA", entries: [oldMob] }])]
  );
  return db;
}

test("Persona removes its empty anime binders without deleting Igor; Mob joins its existing identity and preserves player data, sources and Fate branches", async t => {
  const db = await fixture(t);
  const protectedTables = [
    "user_cards",
    "wishlists",
    "user_profiles",
    "card_franchises",
    "binder_favorite_preferences",
    "panini_album_favorites",
    "anime_series_origin_evidence",
    "anime_series_card_assignments",
    "anime_series_protected_cards"
  ];
  const before = new Map(
    await Promise.all(
      protectedTables.map(async table => [table, await rows(db, table)])
    )
  );
  const cardsBefore = (
    await db.query(
      "select id,to_jsonb(c)-'categorie' snapshot from public.cards c order by id"
    )
  ).rows;
  const fateBefore = (
    await db.query(
      "select * from public.catalogue_binder_links where source_license like 'Fate%' order by card_id"
    )
  ).rows;
  await db.exec(recipe);
  for (const table of protectedTables)
    assert.deepEqual(await rows(db, table), before.get(table), table);
  assert.deepEqual(
    (
      await db.query(
        "select id,to_jsonb(c)-'categorie' snapshot from public.cards c order by id"
      )
    ).rows,
    cardsBefore
  );
  assert.deepEqual(
    (
      await db.query(
        "select * from public.catalogue_binder_links where source_license like 'Fate%' order by card_id"
      )
    ).rows,
    fateBefore
  );
  assert.equal(
    (await db.query("select categorie from public.cards where id=$1", [igor]))
      .rows[0].categorie,
    "VIDEO GAMES"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.catalogue_binder_links where category='ANIME/MANGA' and source_license in ('Persona 5','PERSONA 3')"
      )
    ).rows[0].n,
    0
  );
  for (const title of ["Persona 5", "PERSONA 3"])
    assert.equal(
      (
        await db.query(
          "select count(distinct card_id)::int n from public.catalogue_binder_links where category='VIDEO GAMES' and display_name=$1",
          [title]
        )
      ).rows[0].n,
      2
    );
  assert.equal(
    (
      await db.query(
        "select count(distinct card_id)::int n from public.catalogue_binder_links where binder_key=$1",
        ["series:" + mob]
      )
    ).rows[0].n,
    3
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.catalogue_binder_links where binder_key=$1",
        [oldMob]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (await db.query("select public.canonical_binder_key($1) key", [oldMob]))
      .rows[0].key,
    "series:" + mob
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  const page = (
    await db.query(
      "select public.get_binder_cards_page($1,$2,'','','',false,0,24,'rarity') result",
      [owner, oldMob]
    )
  ).rows[0].result;
  assert.equal(page.total, 3);
  assert.equal(page.binderTotal, 3);
  assert.deepEqual(
    page.items.map(c => c.id).sort(),
    [id(20), id(21), id(22)].sort()
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.binder_favorite_keys($1) where binder_key=$2",
        [owner, "series:" + mob]
      )
    ).rows[0].n,
    1
  );
  const aliases = (
    await db.query(
      "select public.get_card_binder_metadata(array[$1::uuid]) result",
      [id(21)]
    )
  ).rows[0].result;
  assert.equal(aliases[0].binders[0].name, "Mob Psycho 100");
  assert.ok(aliases[0].binders[0].searchNames.includes("Mob Psycho 100 I"));
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await db.exec(recipe);
  assert.deepEqual(await rows(db, "user_cards"), before.get("user_cards"));
});

test("correction can roll back, and refuses unexpected mappings, new Persona casts or saved selections", async t => {
  const db = await fixture(t);
  const cards = await rows(db, "cards"),
    settings = await rows(db, "anime_series_settings");
  await db.exec(
    `begin;${transactionBody(recipe, "Persona Mob correction")}rollback;`
  );
  assert.deepEqual(await rows(db, "cards"), cards);
  assert.deepEqual(await rows(db, "anime_series_settings"), settings);
  await db.exec(
    "update public.anime_series_settings set license_mapping_version='different'"
  );
  await assert.rejects(db.exec(recipe), /PERSONA_MOB_MAPPING_CHANGED/);
  await db.exec("rollback");
  await db.exec(
    "update public.anime_series_settings set license_mapping_version='71c6fc67af55d11c1a390cdbba4443093498cbda896e43a49bc9a3b074c6291c'"
  );
  await db.query(
    "insert into public.binder_favorite_preferences(user_id,binder_key,favorite) values($1,$2,true)",
    [owner, oldPersona]
  );
  await assert.rejects(db.exec(recipe), /PERSONA_SAVED_SELECTION_CHANGED/);
  await db.exec("rollback");
  await db.query(
    "delete from public.binder_favorite_preferences where binder_key=$1",
    [oldPersona]
  );
  await db.query(
    "update public.cards set categorie='ANIME/MANGA' where id=$1",
    [id(10)]
  );
  await assert.rejects(db.exec(recipe), /PERSONA_CAST_CHANGED/);
  await db.exec("rollback");
  assert.equal(
    (await db.query("select categorie from public.cards where id=$1", [igor]))
      .rows[0].categorie,
    "ANIME/MANGA"
  );
});
