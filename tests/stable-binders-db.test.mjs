import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import { anilistEvidenceDigest } from "../scripts/anilist-import-provenance.mjs";

test("stable binders preserve sources and protected cards across RPCs, preferences, imports and rollback", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/recipes/anime_series_projection.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  for (const role of ["anon", "authenticated"])
    for (const table of [
      "anime_series_settings",
      "anime_series_origin_evidence",
      "anime_series_card_assignments"
    ]) {
      assert.equal(
        (
          await db.query("select has_table_privilege($1,$2,'SELECT') allowed", [
            role,
            "public." + table
          ])
        ).rows[0].allowed,
        false,
        "Legacy rehearsal must not expose integrated catalogue proofs"
      );
    }
  const owner = "a7100000-0000-4000-8000-000000000001";
  const viewer = "a7100000-0000-4000-8000-000000000002";
  const binder = "a7200000-0000-4000-8000-000000000001";
  const batch = "a7300000-0000-4000-8000-000000000001";
  for (const [id, pseudo] of [
    [owner, "BinderOwner"],
    [viewer, "BinderViewer"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [owner]
  );
  const add = async (
    sourceId,
    title,
    source = "anilist",
    rarity = "C",
    category = "ANIME/MANGA"
  ) =>
    (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,$3,$4,$5,'https://example.test/card.png',$6) returning *",
        [sourceId, "Character " + sourceId, category, title, rarity, source]
      )
    ).rows[0];
  const first = await add("101", "Audit Alpha");
  const second = await add("102", "Audit Alpha 2", "anilist", "R");
  const manual = await add("manual-102", "Audit Alpha 2", "manual");
  const unknown = await add("unknown-102", "Audit Alpha 2", "unknown");
  const protectedCard = await add("103", "Audit Alpha 2");
  const game = await add("game-1", "Audit Other", "test", "C", "VIDEO GAMES");
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values($1,'Secondary exact source',1)",
    [first.id]
  );
  await db.query(
    "insert into public.anime_series_binders values($1,1001,'Audit Alpha')",
    [binder]
  );
  await db.query(
    "insert into public.anime_series_media_rules values(1001,$1,'A',true),(1002,$1,'A',true)",
    [binder]
  );
  await db.query(
    "insert into public.anime_series_aliases values($1,'Verified Romaji Alpha')",
    [binder]
  );
  for (const [card, mid] of [
    [first, 1001],
    [second, 1002],
    [protectedCard, 1002]
  ]) {
    await db.query(
      "insert into public.anime_series_origin_evidence(card_id,character_id,media_id,verified_snapshot,import_evidence_sha256) select id,source_id::int,$2,to_jsonb(cards),repeat('a',64) from public.cards where id=$1",
      [card.id, mid]
    );
    await db.query(
      "insert into public.anime_series_card_assignments values($1,$2,$3)",
      [card.id, card.franchise, mid]
    );
  }
  await db.query(
    "insert into public.anime_series_protected_cards values($1,'Immutable excluded import')",
    [protectedCard.id]
  );
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'C'),($1,$2,'R')",
    [owner, first.id]
  );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,'Audit Alpha'),($1,'Audit Alpha 2')",
    [owner]
  );
  await db.query(
    "update public.user_profiles set profile_widgets=$2 where user_id=$1",
    [
      owner,
      JSON.stringify([
        { category: "ANIME/MANGA", entries: ["Audit Alpha", "Audit Alpha 2"] }
      ])
    ]
  );
  const baselineCards = (
    await db.query(
      "select jsonb_agg(to_jsonb(c) order by id) value from public.cards c"
    )
  ).rows[0].value;
  const legacyWidgets = (
    await db.query(
      "select profile_widgets from public.user_profiles where user_id=$1",
      [owner]
    )
  ).rows[0].profile_widgets;
  const links = () =>
    db.query(
      "select card_id,source_license,binder_key,display_name from public.catalogue_binder_links order by card_id,source_license"
    );
  const disabled = (await links()).rows;
  assert(
    disabled.every(
      l =>
        l.binder_key.startsWith("source:") &&
        l.display_name === l.source_license
    )
  );
  await db.exec(
    "update public.anime_series_settings set enabled=true,mapping_version='synthetic-validated-v3'"
  );
  const projected = (await links()).rows;
  for (const card of [manual, unknown, protectedCard, game])
    assert.deepEqual(
      projected.filter(l => l.card_id === card.id),
      disabled.filter(l => l.card_id === card.id)
    );
  assert(
    projected
      .filter(
        l =>
          [first.id, second.id].includes(l.card_id) &&
          l.source_license !== "Secondary exact source"
      )
      .every(l => l.binder_key === "series:" + binder)
  );
  assert.equal(
    projected.find(l => l.source_license === "Secondary exact source")
      .binder_key,
    disabled.find(l => l.source_license === "Secondary exact source").binder_key
  );

  const login = async (role, id = null) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? ""
    ]);
    await db.exec("set role " + role);
  };
  const value = async (sql, params = []) =>
    (await db.query(sql, params)).rows[0].value;
  const albums = async (query = "", offset = 0, favorite = false) =>
    value(
      "select public.get_binder_albums_page($1,$2,'ANIME/MANGA',$3,$4,72) value",
      [owner, query, favorite, offset]
    );
  await login("authenticated", owner);
  await assert.rejects(
    db.query("select public.import_anilist_cards('[]',$1)", [batch]),
    /permission denied/i
  );
  await assert.rejects(
    db.exec("select * from public.anime_series_origin_evidence"),
    /permission denied/i
  );
  await assert.rejects(
    db.exec("select * from public.catalogue_binder_links"),
    /permission denied/i
  );
  await assert.rejects(
    db.exec("update public.anime_series_settings set enabled=false"),
    /permission denied/i
  );
  const page = await albums("Verified Romaji");
  assert.equal(page.total, 1);
  assert.equal(page.items[0].total, 2);
  assert.equal(page.items[0].owned, 1);
  assert.equal(page.items[0].percent, 50);
  assert.equal(page.items[0].favorite, true);
  assert.equal(page.favoriteConflicts.length, 1);
  assert.equal((await albums("Verified Romaji", 999)).total, 1);
  assert.deepEqual((await albums("Verified Romaji", 999)).items, []);
  const cards = await value(
    "select public.get_binder_cards_page($1,$2,'','ANIME/MANGA','R',false,0,24) value",
    [owner, "series:" + binder]
  );
  assert.equal(cards.total, 1);
  assert.equal(cards.binderTotal, 2);
  assert.equal(cards.binderOwned, 1);
  assert.equal(cards.items[0].anime, second.franchise);
  assert.equal(cards.items[0].id, second.id);
  const owned = await value(
    "select public.get_binder_cards_page($1,$2,'','','',true,0,24) value",
    [owner, "series:" + binder]
  );
  assert.equal(owned.total, 1);
  const catalogue = await value(
    "select public.get_binder_catalogue_page('verified romaji','ANIME/MANGA','',0,24) value"
  );
  assert.equal(catalogue.total, 2);
  const multi = await value(
    `select public.get_binder_cards_page($1,$2,'','["ANIME/MANGA","VIDEO GAMES"]','["C","R"]',false,0,24) value`,
    [owner, "series:" + binder]
  );
  assert.equal(multi.total, 2);
  assert.equal(multi.binderTotal, 2);
  assert.equal(multi.binderOwned, 1);
  assert.deepEqual(multi.items.map(c => c.rarity).sort(), ["C", "R"]);
  const multiCatalogue = await value(
    `select public.get_binder_catalogue_page('','["ANIME/MANGA","VIDEO GAMES"]','["C","R"]',0,24) value`
  );
  assert.equal(multiCatalogue.total, 6);
  const multiAlbums = await value(
    `select public.get_binder_albums_page($1,'Verified Romaji','["ANIME/MANGA","VIDEO GAMES"]',false,0,72) value`,
    [owner]
  );
  assert.equal(multiAlbums.total, 1);
  assert.equal(multiAlbums.items[0].owned, 1);
  assert(
    catalogue.items.every(c =>
      [first.franchise, second.franchise].includes(c.anime)
    )
  );
  await assert.rejects(
    value(
      "select public.resolve_binder_favorite('Audit Alpha 2',array['source:not-a-key']) value"
    ),
    /BINDER_FAVORITE_INVALID/
  );
  await value(
    "select public.resolve_binder_favorite('Audit Alpha 2',$1) value",
    [["series:" + binder]]
  );
  assert.equal((await albums()).favoriteConflicts.length, 0);
  await value("select public.set_binder_favorite($1,false) value", [
    "series:" + binder
  ]);
  assert.equal((await albums("Verified Romaji")).items[0].favorite, false);
  await value("select public.set_binder_favorite($1,true) value", [
    "series:" + binder
  ]);
  const widgets = await value(
    "select public.set_profile_binder_widgets($1) value",
    [
      JSON.stringify([
        { category: "ANIME/MANGA", entries: ["series:" + binder] }
      ])
    ]
  );
  assert.equal(widgets[0].labels["series:" + binder], "Audit Alpha");
  await assert.rejects(
    value("select public.set_profile_binder_widgets($1) value", [
      JSON.stringify([
        { category: "VIDEO GAMES", entries: ["series:" + binder] }
      ])
    ]),
    /WIDGETS_INVALID/
  );
  const details = await value(
    "select public.get_profile_details_with_binders(null) value"
  );
  assert.equal(details.widgets[0].entries[0], "series:" + binder);
  assert.equal(
    details.favoriteAlbums.find(a => a.binderKey === "series:" + binder).owned,
    1
  );

  await login("authenticated", viewer);
  assert.equal(
    (await albums()).items.find(a => a.binderKey === "series:" + binder)
      .favorite,
    true
  );
  await login("postgres");
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  await login("authenticated", viewer);
  await assert.rejects(albums(), /PROFILE_PRIVATE/);
  await login("anon");
  await assert.rejects(albums(), /permission denied|AUTH_REQUIRED/i);
  const metadata = await value(
    "select public.get_card_binder_metadata($1) value",
    [[first.id, manual.id]]
  );
  assert.equal(metadata.length, 2);
  assert(metadata[0].binders);
  assert(!JSON.stringify(metadata).includes("verified_snapshot"));
  await assert.rejects(
    value("select public.import_anilist_cards('[]',$1) value", [batch]),
    /permission denied/i
  );

  await login("service_role");
  const incoming = {
    source: "anilist",
    source_id: "150",
    nom: "A genuinely new character",
    categorie: "ANIME/MANGA",
    franchise: "Tokyo Ghoul √A",
    franchise_romaji: "Tokyo Ghoul √A",
    rarete_base: "C",
    image_url: "https://example.test/new.png",
    favoris_count: 0,
    anilist_media_id: 1002,
    anilist_proof_version: "anilist-import-v1",
    anilist_evidence_sha256: anilistEvidenceDigest(
      150,
      1002,
      "Tokyo Ghoul √A",
      "Tokyo Ghoul √A"
    )
  };
  const imported = await value(
    "select public.import_anilist_cards($1,$2) value",
    [JSON.stringify([incoming]), batch]
  );
  assert.equal(imported[0].status, "ASSIGNED_APPROVED_MEDIA");
  const importedCard = (
    await db.query("select * from public.cards where id=$1", [
      imported[0].card_id
    ])
  ).rows[0];
  assert.equal(importedCard.franchise, incoming.franchise);
  const existing = await value(
    "select public.import_anilist_cards($1,$2) value",
    [
      JSON.stringify([
        {
          ...incoming,
          source_id: second.source_id,
          nom: "Must not replace",
          franchise: "Must not move"
        }
      ]),
      batch
    ]
  );
  assert.equal(existing[0].status, "EXISTING_UNCHANGED");
  assert.deepEqual(
    (await db.query("select * from public.cards where id=$1", [second.id]))
      .rows[0],
    second
  );
  const unproven = await value(
    "select public.import_anilist_cards($1,$2) value",
    [
      JSON.stringify([
        { ...incoming, source_id: "151", anilist_media_id: null }
      ]),
      batch
    ]
  );
  assert.equal(unproven[0].status, "SOURCE_ONLY_REVIEW_REQUIRED");
  const unknownMedia = await value(
    "select public.import_anilist_cards($1,$2) value",
    [
      JSON.stringify([
        {
          ...incoming,
          source_id: "152",
          anilist_media_id: 999999,
          anilist_evidence_sha256: anilistEvidenceDigest(
            152,
            999999,
            incoming.franchise,
            incoming.franchise_romaji
          )
        }
      ]),
      batch
    ]
  );
  assert.equal(unknownMedia[0].status, "SOURCE_ONLY_REVIEW_REQUIRED");
  await assert.rejects(
    value("select public.import_anilist_cards($1,$2) value", [
      JSON.stringify([{ ...incoming, source: "manual" }]),
      batch
    ]),
    /ANILIST_IMPORT_INVALID/
  );

  await login("postgres");
  assert.deepEqual(
    (
      await db.query(
        "select profile_widgets from public.user_profiles where user_id=$1",
        [owner]
      )
    ).rows[0].profile_widgets,
    legacyWidgets
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.panini_album_favorites where user_id=$1",
        [owner]
      )
    ).rows[0].n,
    2
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.user_cards where user_id=$1",
        [owner]
      )
    ).rows[0].n,
    2
  );
  assert.deepEqual(
    (
      await db.query(
        "select jsonb_agg(to_jsonb(c) order by id) value from public.cards c where source_id not in ('150','151','152')"
      )
    ).rows[0].value,
    baselineCards
  );
  await db.query(
    "update public.cards set favoris_count=favoris_count+1 where id=$1",
    [first.id]
  );
  assert.equal(
    (await links()).rows.find(
      l => l.card_id === first.id && l.source_license === first.franchise
    ).binder_key,
    "series:" + binder
  );
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const exportRequest = "a7400000-0000-4000-8000-000000000001";
  await db.query("select public.reserve_data_export($1,$2)", [
    owner,
    exportRequest
  ]);
  const exported = await value("select public.build_data_export($1,$2) value", [
    owner,
    exportRequest
  ]);
  assert(
    exported.binder_favorite_preferences.some(
      p => p.binder_key === "series:" + binder && p.favorite
    )
  );
  assert.equal(
    exported.binder_legacy_favorite_resolutions[0].license,
    "Audit Alpha 2"
  );
  assert.equal(
    exported.binder_profile_widgets[0].entries[0],
    "series:" + binder
  );
  await db.query("update public.cards set nom='Locally edited' where id=$1", [
    first.id
  ]);
  assert(
    (await links()).rows
      .filter(l => l.card_id === first.id)
      .every(l => l.binder_key.startsWith("source:"))
  );
  for (let n = 1; n <= 75; n++) {
    const extra = await add("bulk-" + n, "Bulk source " + n, "manual");
    const key = (await links()).rows.find(
      l => l.card_id === extra.id
    ).binder_key;
    await db.query(
      "insert into public.binder_favorite_preferences(user_id,binder_key,favorite) values($1,$2,true)",
      [owner, key]
    );
  }
  await login("authenticated", owner);
  const completeProfile = await value(
    "select public.get_profile_details_with_binders(null) value"
  );
  assert(
    completeProfile.favoriteAlbums.length >= 75,
    "Profile favorites must never be truncated to the 72-item album page"
  );
  await login("postgres");
  await db.exec("update public.anime_series_settings set enabled=false");
  assert(
    (await links()).rows.every(
      l =>
        l.binder_key.startsWith("source:") &&
        l.display_name === l.source_license
    )
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.binder_favorite_preferences where user_id=$1",
        [owner]
      )
    ).rows[0].n > 0,
    true
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.binder_profile_widgets where user_id=$1",
        [owner]
      )
    ).rows[0].n,
    1
  );
});
