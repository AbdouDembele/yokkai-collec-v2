import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import { transactionBody } from "../scripts/plan-deploy-migrations.mjs";
import { prepareSmallAnimeBinderMerges } from "../scripts/prepare-small-anime-binder-merges.mjs";

const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../data/editorial/small-anime-binder-merges-20261026.json",
      import.meta.url
    ),
    "utf8"
  )
);
const recipe = readFileSync(
  new URL(
    "../supabase/recipes/merge_small_anime_binders_20261026.sql",
    import.meta.url
  ),
  "utf8"
);
const hash = ids =>
  createHash("md5")
    .update([...new Set(ids)].sort().join(","))
    .digest("hex");
const owner = "9a000000-0000-4000-8000-000000000001";
const id = n => `9b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const all = async (db, table) =>
  (
    await db.query(
      `select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`
    )
  ).rows;

test("the complete reviewed manifest generates its exact offline recipe and excludes explicit boundaries", () => {
  assert.equal(prepareSmallAnimeBinderMerges(manifest), recipe);
  assert.equal(manifest.groups.length, 93);
  const changed = new Set(manifest.merges.map(m => m.old_key));
  for (const b of manifest.kept_separate)
    assert.equal(changed.has(b.key), false, b.name);
  assert.ok(manifest.kept_separate.some(b => b.name.includes("Fate/")));
  assert.ok(manifest.kept_separate.some(b => /Yu.Gi.Oh/i.test(b.name)));
  for (const title of [
    "Genshin Impact",
    "Honkai: Star Rail",
    "Little Witch Academia",
    "Cardfight Vanguard",
    "TEKKEN 8"
  ])
    assert.ok(manifest.groups.some(g => g.target === title));
  const overlap = structuredClone(manifest);
  overlap.groups[1].source_binders.push(overlap.groups[0].source_binders[0]);
  assert.throws(() => prepareSmallAnimeBinderMerges(overlap));
  const excluded = structuredClone(manifest);
  excluded.kept_separate.push({ key: excluded.merges[0].old_key });
  assert.throws(() => prepareSmallAnimeBinderMerges(excluded));
});

async function fixture(t) {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const reviewed = structuredClone(manifest);
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [owner, JSON.stringify({ pseudo: "FullBinderAudit" })]
  );
  await db.query(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true,mapping_version=$1,license_mapping_version=encode(sha256(convert_to('persona-mob-correction-20261026:v1','UTF8')),'hex')",
    [manifest.base_mapping_version]
  );
  const previous = new Map();
  for (const m of reviewed.merges)
    if (m.previous_group_id)
      previous.set(
        m.previous_group_id,
        reviewed.groups
          .flatMap(g => g.source_binders)
          .find(b => b.key === "series:" + m.previous_group_id)?.name ??
          "Prior reviewed binder"
      );
  for (const [group, name] of previous)
    await db.query(
      "insert into public.catalogue_binder_groups values($1,$2,true)",
      [group, name]
    );
  for (const m of reviewed.merges)
    if (m.previous_group_id)
      await db.query(
        "insert into public.catalogue_binder_group_merges values($1,$2,$3,$4)",
        [m.old_key, m.previous_group_id, m.category, m.source_license]
      );
  const cards = new Map();
  let count = 10;
  for (const group of reviewed.groups)
    for (const b of group.source_binders) {
      let category = b.category,
        source = b.sources[0];
      if (b.key.startsWith("source:")) {
        const m = reviewed.merges.find(m => m.old_key === b.key);
        category = m.category;
        source = m.source_license;
      } else if (previous.has(b.key.slice(7))) {
        const m = reviewed.merges.find(
          m => m.previous_group_id === b.key.slice(7) && m.category
        );
        assert.ok(
          m,
          "Fixture needs a raw source for old editorial group " + b.name
        );
        category = m.category;
        source = m.source_license;
      } else {
        await db.query(
          "insert into public.anime_series_binders values($1,$2,$3)",
          [b.key.slice(7), 900000 + count, b.name]
        );
        await db.query(
          "insert into public.anime_license_binders values($1,$2)",
          [b.key.slice(7), b.name]
        );
        await db.query(
          "insert into public.anime_license_source_rules values($1,$2)",
          [source, b.key.slice(7)]
        );
      }
      const card = id(count++);
      cards.set(b.key, card);
      await db.query(
        "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1::uuid,$1::uuid::text,$2,$3,$4,'SR','https://i.imgur.com/kept.png','review-fixture')",
        [card, "Character " + count, category, source]
      );
    }
  for (const name of [
    "Fate/stay night",
    "Yu-Gi-Oh! GX",
    "ONE PIECE in LOVE",
    "Shangri-La Frontier",
    "Unrelated work"
  ])
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1::uuid,$1::uuid::text,'Unrelated','ANIME/MANGA',$2,'C','https://i.imgur.com/kept.png','review-fixture')",
      [id(count++), name]
    );
  // A cross-license card keeps its unrelated membership as well as its new group.
  const first = reviewed.groups[0].source_binders[0];
  await db.query(
    "insert into public.card_franchises values($1,'Unrelated work',1)",
    [cards.get(first.key)]
  );
  await db.query(
    "insert into public.user_cards(id,user_id,card_id,rarity,is_locked,custom_image_url) values($1,$2,$3,'SR',true,'https://i.imgur.com/custom.png')",
    [id(5000), owner, cards.get(first.key)]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values($1,$2)",
    [owner, cards.get(reviewed.groups[1].source_binders[0].key)]
  );
  await db.query(
    "insert into public.binder_favorite_preferences(user_id,binder_key,favorite,license_favorite) values($1,$2,true,true)",
    [owner, first.key]
  );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,$2)",
    [owner, first.name]
  );
  for (const g of reviewed.groups) {
    const ids = [];
    for (const b of g.source_binders) {
      const links = (
        await db.query(
          "select distinct card_id from public.catalogue_binder_links where binder_key=$1",
          [b.key]
        )
      ).rows.map(r => r.card_id);
      assert.ok(links.length, "Fixture source missing: " + b.name);
      b.cards = links.length;
      b.card_ids_md5 = hash(links);
      ids.push(...links);
    }
    g.expected_total = new Set(ids).size;
    g.expected_ids_md5 = hash(ids);
  }
  return { db, reviewed };
}

test("all reviewed groups, cross-category binders, aliases and old favorites work without rewriting cards or player data", async t => {
  const { db, reviewed } = await fixture(t);
  const preserved = [
    "cards",
    "card_franchises",
    "user_profiles",
    "user_cards",
    "wishlists",
    "binder_favorite_preferences",
    "panini_album_favorites"
  ];
  const before = new Map(
    await Promise.all(
      preserved.map(async table => [table, await all(db, table)])
    )
  );
  const sql = prepareSmallAnimeBinderMerges(reviewed);
  await db.exec(sql);
  for (const table of preserved)
    assert.deepEqual(await all(db, table), before.get(table), table);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  for (const group of reviewed.groups) {
    const key = "series:" + group.group_id;
    const result = (
      await db.query(
        "select public.get_binder_cards_page($1,$2,'','','',false,0,24,'rarity') result",
        [owner, key]
      )
    ).rows[0].result;
    assert.equal(result.total, group.expected_total, group.target);
    assert.equal(result.binderTotal, group.expected_total, group.target);
    for (const old of group.source_binders)
      assert.equal(
        (
          await db.query("select public.canonical_binder_key($1) key", [
            old.key
          ])
        ).rows[0].key,
        key,
        old.name
      );
  }
  const group = reviewed.groups[0];
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.binder_favorite_keys($1) where binder_key=$2",
        [owner, "series:" + group.group_id]
      )
    ).rows[0].n,
    1
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.catalogue_binder_links where source_license='Unrelated work'"
      )
    ).rows[0].n,
    2
  );
});

test("the full recipe rolls back and fails closed if a reviewed card set changes", async t => {
  const { db, reviewed } = await fixture(t);
  const before = await all(db, "cards"),
    settings = await all(db, "anime_series_settings");
  const sql = prepareSmallAnimeBinderMerges(reviewed);
  await db.exec(
    `begin;${transactionBody(sql, "small binder review")}rollback;`
  );
  assert.deepEqual(await all(db, "cards"), before);
  assert.deepEqual(await all(db, "anime_series_settings"), settings);
  reviewed.groups[0].source_binders[0].cards++;
  await assert.rejects(
    db.exec(prepareSmallAnimeBinderMerges(reviewed)),
    /SMALL_BINDER_CARD_SET_CHANGED/
  );
  await db.exec("rollback");
  assert.deepEqual(await all(db, "cards"), before);
});
