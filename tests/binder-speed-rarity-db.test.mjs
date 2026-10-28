import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("single-pass albums retain all favorite, search and category semantics; card sort is global before pagination", async t => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migration = "20261025130000_fast_binders_and_rarity_sort.sql";
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(n => n.endsWith(".sql") && n < migration)
      .sort()
  });
  t.after(() => db.close());
  const owner = "ae100000-0000-4000-8000-000000000001",
    other = "ae100000-0000-4000-8000-000000000002";
  const binder = "ae200000-0000-4000-8000-000000000001",
    second = "ae200000-0000-4000-8000-000000000002";
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"SortOwner"}\'),($2,\'{"pseudo":"SortOther"}\')',
    [owner, other]
  );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  for (const [id, media, title] of [
    [binder, 20001, "Rarity Fixture"],
    [second, 20002, "Rarity Other"]
  ]) {
    await db.query("insert into public.anime_series_binders values($1,$2,$3)", [
      id,
      media,
      title
    ]);
    await db.query(
      "insert into public.anime_series_media_rules values($1,$2,'A',true)",
      [media, id]
    );
    await db.query("insert into public.anime_license_binders values($1,$2)", [
      id,
      title
    ]);
    await db.query(
      "insert into public.anime_license_source_rules values($1,$2)",
      [title, id]
    );
    await db.query(
      "insert into public.anime_license_aliases values($1,$2),($1,'Shared alias')",
      [id, title]
    );
  }
  const cards = [];
  for (let i = 0; i < 85; i++) {
    const rarity = ["C", "R", "SR", "SSR", "LR"][i % 5],
      id = "ae300000-0000-4000-8000-" + String(i + 1).padStart(12, "0");
    const row = (
      await db.query(
        "insert into public.cards(id,source,source_id,nom,franchise,categorie,rarete_base,image_url) values($1,$2,$3,$4,'Rarity Fixture','ANIME/MANGA',$5,'https://example.test/sort.png') returning *",
        [
          id,
          i < 2 ? "anilist" : "manual",
          String(21000 + i),
          i < 2 ? "Same name" : "Card " + String(i).padStart(3, "0"),
          rarity
        ]
      )
    ).rows[0];
    cards.push(row);
    if (i < 2) {
      await db.query(
        "insert into public.anime_series_origin_evidence(card_id,character_id,media_id,verified_snapshot,import_evidence_sha256) select id,source_id::int,20001,to_jsonb(cards),repeat('a',64) from public.cards where id=$1",
        [id]
      );
      await db.query(
        "insert into public.anime_series_card_assignments values($1,'Rarity Fixture',20001)",
        [id]
      );
    }
  }
  await db.query(
    "insert into public.anime_series_protected_cards values($1,'Manual source protected')",
    [cards[4].id]
  );
  await db.query(
    "insert into public.cards(source_id,source,nom,franchise,categorie,rarete_base,image_url) values('sort-other','manual','Other card','Rarity Other','ANIME/MANGA','SSR','https://example.test/other.png')"
  );
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values($1,'Rarity Other',1)",
    [cards[5].id]
  );
  for (const category of ["FILM", "COMICS"]) {
    const c = (
      await db.query(
        "insert into public.cards(source_id,source,nom,franchise,categorie,rarete_base,image_url) values($1,'manual','Cross card','Shared source',$1,'C','https://example.test/cross.png') returning id",
        [category]
      )
    ).rows[0];
    await db.query(
      "insert into public.card_franchises values($1,'Shared source',1) on conflict do nothing",
      [c.id]
    );
  }
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity,date_obtention) values($1,$2,'C','2026-01-01'),($1,$2,'R','2026-03-01'),($1,$3,'R','2026-02-01'),($1,$3,'R','2026-04-01')",
    [owner, cards[0].id, cards[1].id]
  );
  const favorites = [
    "Rarity Fixture",
    "Rarity Other",
    "Shared alias",
    "Shared source",
    "Resolved title",
    ...Array.from({ length: 46 }, (_, i) => "Absent title " + i)
  ];
  for (const license of favorites)
    await db.query(
      "insert into public.panini_album_favorites(user_id,license) values($1,$2)",
      [owner, license]
    );
  await db.query(
    "insert into public.binder_legacy_favorite_resolutions values($1,'Resolved title',now())",
    [owner]
  );
  await db.query(
    "insert into public.binder_favorite_preferences(user_id,binder_key,favorite,license_favorite) values($1,$2,true,false),($1,$3,false,true)",
    [owner, "series:" + binder, "series:" + second]
  );
  await db.exec(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true,license_mapping_version='sort-test'"
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  const value = async (q, args = []) => (await db.query(q, args)).rows[0].value;
  const options = [
    ["", "", false, 0, 72],
    ["Rarity", "ANIME/MANGA", false, 0, 72],
    ["Shared", "", false, 0, 72],
    ["", "FILM", false, 0, 72],
    ["", '["ANIME/MANGA","COMICS"]', false, 0, 72],
    ["", "", true, 0, 72],
    ["", "", false, 1, 2]
  ];
  const albums = () =>
    Promise.all(
      options.map(args =>
        value(
          "select public.get_binder_albums_page(null,$1,$2,$3,$4,$5) value",
          args
        )
      )
    );
  const before = await albums();
  await db.exec(
    "update public.anime_series_settings set license_grouping_enabled=false"
  );
  const oldMode = await albums();
  await db.exec(
    "update public.anime_series_settings set license_grouping_enabled=true"
  );
  const sourceKey =
    "source:" +
    createHash("sha256")
      .update("ANIME/MANGA\u001fRarity Fixture")
      .digest("hex");
  const previousCards = await value(
    "select public.get_binder_cards_page(null,$1,'','','',false,0,60) value",
    ["series:" + binder]
  );
  const rows = async () =>
    (await db.query("select to_jsonb(c) value from public.cards c order by id"))
      .rows;
  const beforeRows = await rows();
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual(await albums(), before);
  await db.exec(
    "update public.anime_series_settings set license_grouping_enabled=false"
  );
  assert.deepEqual(await albums(), oldMode);
  const sourceCards = await value(
    "select public.get_binder_cards_page(null,$1,'','','',false,0,60) value",
    [sourceKey]
  );
  assert(sourceCards.total > 0);
  await db.exec(
    "update public.anime_series_settings set license_grouping_enabled=true"
  );
  const page = async (
    offset,
    limit = 12,
    sort = "rarity",
    owned = false,
    rarity = ""
  ) =>
    value(
      "select public.get_binder_cards_page(null,$1,'','',$2,$3,$4,$5,$6) value",
      ["series:" + binder, rarity, owned, offset, limit, sort]
    );
  assert.deepEqual(
    await page(0, 60, "name"),
    previousCards,
    "Explicit name order preserves old source metadata and every matching card"
  );
  const full = [];
  for (let offset = 0; offset < 85; offset += 12) {
    const result = await page(offset);
    assert.equal(result.total, 85);
    assert.equal(result.binderTotal, 85);
    assert.equal(result.binderOwned, 2);
    full.push(...result.items);
  }
  assert.equal(new Set(full.map(c => c.id)).size, 85);
  assert.deepEqual(new Set(full.map(c => c.id)), new Set(cards.map(c => c.id)));
  assert.deepEqual(
    full.map(c => c.rarity),
    ["LR", "SSR", "SR", "R", "C"].flatMap(r => Array(17).fill(r)),
    "All pages form one rarity order"
  );
  assert.deepEqual(
    await value(
      "select public.get_binder_cards_page(null,$1,'','','',false,0,12) value",
      ["series:" + binder]
    ),
    await page(0)
  );
  assert.deepEqual(await page(0, 12, "invalid"), await page(0));
  const filtered = await page(0, 60, "rarity", false, '["LR","SSR"]');
  assert.equal(filtered.total, 34);
  assert.equal(filtered.binderTotal, 85);
  assert(filtered.items.every(c => ["LR", "SSR"].includes(c.rarity)));
  assert.deepEqual(
    (await page(0, 60, "recent", true)).items.map(c => c.id),
    [cards[1].id, cards[0].id]
  );
  assert.deepEqual(
    (await page(0, 60, "oldest", true)).items.map(c => c.id),
    [cards[0].id, cards[1].id]
  );
  assert.deepEqual(await rows(), beforeRows);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other
  ]);
  await db.exec("set role authenticated");
  await assert.rejects(
    page(0).then(() =>
      db.query(
        "select public.get_binder_cards_page($1,$2,'','','',false,0,12,'rarity')",
        [owner, "series:" + binder]
      )
    ),
    /PROFILE_PRIVATE/
  );
  await db.exec("reset role");
  await db.exec("set role anon");
  await assert.rejects(page(0), /permission denied/i);
  await db.exec("reset role");
});
