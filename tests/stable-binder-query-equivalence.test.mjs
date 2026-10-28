import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("optimized binder queries retain exact source/proof semantics and complete search results", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const original = readFileSync(
    new URL(
      "../supabase/migrations/20261025010000_stable_series_binders.sql",
      import.meta.url
    ),
    "utf8"
  );
  const view = original.slice(
    original.indexOf("create view public.catalogue_binder_links"),
    original.indexOf("revoke all on public.catalogue_binder_links")
  );
  await db.exec(
    view.replace(
      "public.catalogue_binder_links",
      "public.reference_binder_links"
    )
  );
  const fn = name => {
    const from = original.indexOf("create function public." + name + "(");
    return original
      .slice(from, original.indexOf("$$;", original.indexOf("as $$", from)) + 3)
      .replace("public." + name + "(", "public.reference_" + name + "(")
      .replaceAll(
        "public.catalogue_binder_links",
        "public.reference_binder_links"
      );
  };
  await db.exec(fn("get_binder_catalogue_page"));
  const binder = "a8200000-0000-4000-8000-000000000001";
  await db.query(
    "insert into public.anime_series_binders values($1,4001,'Confirmed Global Series')",
    [binder]
  );
  await db.query(
    "insert into public.anime_series_media_rules values(4001,$1,'A',true)",
    [binder]
  );
  await db.query(
    "insert into public.anime_series_aliases values($1,'Verified Romaji'),($1,'English Known Title')",
    [binder]
  );
  const cards = [];
  for (const [id, source, title, rarity, category] of [
    ["401", "anilist", "Exact Season 1", "R", "ANIME/MANGA"],
    ["402", "anilist", "Exact Season 2", "SR", "ANIME/MANGA"],
    ["403", "manual", "Exact Season 2", "R", "ANIME/MANGA"],
    ["404", "unknown", "Exact Season 2", "C", "ANIME/MANGA"],
    ["405", "anilist", "Exact Season 2", "SSR", "ANIME/MANGA"],
    ["406", "anilist", "Exact Season 2", "C", "ANIME/MANGA"],
    ["407", "test", "English Known Title", "R", "VIDEO GAMES"]
  ]) {
    cards.push(
      (
        await db.query(
          "insert into public.cards(source_id,nom,source,franchise,rarete_base,categorie,image_url) values($1,$2,$3,$4,$5,$6,'https://example.test/fixture.png') returning *",
          [id, "Needle " + id, source, title, rarity, category]
        )
      ).rows[0]
    );
  }
  for (const c of cards.filter(c => c.source === "anilist")) {
    await db.query(
      "insert into public.anime_series_origin_evidence(card_id,character_id,media_id,verified_snapshot,import_evidence_sha256) select id,source_id::int,4001,to_jsonb(cards),repeat('a',64) from public.cards where id=$1",
      [c.id]
    );
    await db.query(
      "insert into public.anime_series_card_assignments values($1,$2,4001)",
      [c.id, c.franchise]
    );
  }
  await db.query(
    "insert into public.anime_series_protected_cards values($1,'Protected fixture')",
    [cards[4].id]
  );
  await db.query(
    "update public.cards set image_url='https://example.test/edited.png' where id=$1",
    [cards[5].id]
  );
  await db.query(
    "insert into public.card_franchises values($1,'Independent Secondary Title',1)",
    [cards[0].id]
  );
  const queries = [
    "",
    "Exact",
    "Season 2",
    "Confirmed",
    "Verified Romaji",
    "English Known Title",
    "Needle Verified",
    "Needle Secondary",
    "Independent Title",
    "Definitely Absent",
    "Exact%Global",
    "%",
    "Exact_Season",
    "  verified   romaji  "
  ];
  for (const enabled of [false, true]) {
    await db.query("update public.anime_series_settings set enabled=$1", [
      enabled
    ]);
    const oldLinks = (
      await db.query(
        "select * from public.reference_binder_links order by card_id,source_license"
      )
    ).rows;
    assert.deepEqual(
      (
        await db.query(
          "select * from public.catalogue_binder_links order by card_id,source_license"
        )
      ).rows,
      oldLinks
    );
    for (const query of queries)
      for (const [category, rarity] of [
        ["", ""],
        ["ANIME/MANGA", ""],
        ['["ANIME/MANGA","VIDEO GAMES"]', '["R","SR"]']
      ]) {
        for (const offset of [0, 1]) {
          const args = [query, category, rarity, offset, 2];
          const oldPage = (
            await db.query(
              "select public.reference_get_binder_catalogue_page($1,$2,$3,$4,$5) result",
              args
            )
          ).rows[0].result;
          assert.deepEqual(
            (
              await db.query(
                "select public.get_binder_catalogue_page($1,$2,$3,$4,$5) result",
                args
              )
            ).rows[0].result,
            oldPage,
            JSON.stringify({ enabled, query, category, rarity, offset })
          );
        }
      }
    const aliasPage = (
      await db.query(
        "select public.get_binder_catalogue_page('Verified Romaji','','',0,60) result"
      )
    ).rows[0].result;
    assert.deepEqual(
      aliasPage.items.map(c => c.id).sort(),
      enabled
        ? cards
            .slice(0, 2)
            .map(c => c.id)
            .sort()
        : []
    );
  }
  await db.query(
    "update public.cards set favoris_count=favoris_count+1 where id=$1",
    [cards[0].id]
  );
  assert.equal(
    (
      await db.query(
        "select origin from public.catalogue_binder_links where card_id=$1 and source_license=$2",
        [cards[0].id, cards[0].franchise]
      )
    ).rows[0].origin,
    "series"
  );
});
