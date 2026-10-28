import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  classifyOrigin,
  importIndex,
  mediaTitleIndex,
  resolveImportedMedia,
  stableSeriesId
} from "../scripts/anime-series-provenance.mjs";
import {
  buildSeriesDecisions,
  classifyMediaPair,
  planFutureMedia
} from "../scripts/anime-series-decisions.mjs";
import { fetchScopedMedia } from "../scripts/fetch-anime-audit-media.mjs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import { auditAnimeSeries } from "../scripts/audit-anime-series.mjs";

test("provenance requires independent import evidence and protects manual/unknown cards sharing an AniList license", () => {
  const record = {
    source: "anilist",
    source_id: "12",
    nom: "Hero",
    franchise: "Tokyo Ghoul √A",
    franchise_romaji: "Tokyo Ghoul √A"
  };
  const state = {
    chars: { 12: { id: 12, personnage: "Hero" } },
    anime: { 20850: { en: "Tokyo Ghoul √A", romaji: "Tokyo Ghoul √A" } }
  };
  const records = importIndex([record]),
    titles = mediaTitleIndex(state);
  const card = {
    id: "local",
    source: "anilist",
    source_id: "12",
    nom: "HERO",
    categorie: "ANIME/MANGA",
    franchise: record.franchise,
    franchise_romaji: record.franchise_romaji
  };
  const confirmed = classifyOrigin(card, records, state);
  assert.equal(confirmed.origin, "anilist_confirmed");
  assert.equal(resolveImportedMedia(card, confirmed, titles).media_id, 20850);
  assert.equal(
    classifyOrigin({ ...card, source: "manual" }, records, state).origin,
    "manual"
  );
  assert.equal(
    classifyOrigin({ ...card, source: "other" }, records, state).origin,
    "unknown"
  );
  assert.equal(
    classifyOrigin({ ...card, source_id: "123456" }, records, state).origin,
    "unknown"
  );
  assert.equal(
    classifyOrigin({ ...card, nom: "Changed identity" }, records, state).origin,
    "unknown"
  );
  assert.equal(
    classifyOrigin({ ...card, categorie: "VIDEO GAMES" }, records, state)
      .origin,
    "excluded_category"
  );
  assert.equal(
    resolveImportedMedia(
      { ...card, franchise_romaji: "Unrelated" },
      confirmed,
      titles
    ).media_id,
    null
  );
  const ambiguous = mediaTitleIndex({
    anime: {
      1: { en: "Tokyo Ghoul √A", romaji: "Tokyo Ghoul √A" },
      2: { en: "Tokyo Ghoul √A", romaji: "Tokyo Ghoul √A" }
    }
  });
  assert.equal(resolveImportedMedia(card, confirmed, ambiguous).media_id, null);
});

const media = (id, name, related = [], format = "TV") => ({
  id,
  type: "ANIME",
  format,
  title: { english: name, romaji: name },
  startDate: { year: 2020 },
  relations: {
    edges: related.map(([id, relationType]) => ({ node: { id }, relationType }))
  }
});
test("Tokyo Ghoul has exactly two explicit series and graph relations never merge a major sequel or independent spin-off", () => {
  const records = new Map([
    [20605, media(20605, "Tokyo Ghoul", [[20850, "SEQUEL"]])],
    [20850, media(20850, "Tokyo Ghoul √A", [[100240, "SEQUEL"]])],
    [100240, media(100240, "Tokyo Ghoul:re", [[102351, "SEQUEL"]])],
    [102351, media(102351, "Tokyo Ghoul:re 2nd Season")]
  ]);
  const { rules } = buildSeriesDecisions(records, [...records.keys()]);
  const byId = new Map(rules.map(rule => [rule.media_id, rule]));
  assert.equal(new Set(rules.map(rule => rule.binder_id)).size, 2);
  assert.equal(byId.get(20605).binder_id, byId.get(20850).binder_id);
  assert.equal(byId.get(100240).binder_id, byId.get(102351).binder_id);
  assert.notEqual(byId.get(20605).binder_id, byId.get(100240).binder_id);
  assert.equal(
    classifyMediaPair(records.get(20850), records.get(100240), "SEQUEL").status,
    "C"
  );
  assert.equal(
    classifyMediaPair(media(1, "A"), media(2, "A 2nd Season"), "SEQUEL").status,
    "A"
  );
  assert.equal(
    classifyMediaPair(media(1, "A"), media(2, "A 2nd Season"), "SPIN_OFF")
      .status,
    "C"
  );
  assert.equal(
    classifyMediaPair(media(1, "A"), media(2, "A: New Generation"), "SEQUEL")
      .status,
    "C"
  );
  assert.equal(
    classifyMediaPair(media(1, "A"), media(2, "A Movie", [], "MOVIE"), "SEQUEL")
      .status,
    "B"
  );
  assert.equal(
    planFutureMedia(999, "anilist_confirmed", rules).action,
    "review"
  );
  assert.equal(planFutureMedia(20850, "manual", rules).action, "protect");
  assert.equal(
    planFutureMedia(20850, "anilist_confirmed", rules).action,
    "review"
  );
  assert.equal(
    planFutureMedia(
      20850,
      "anilist_confirmed",
      rules.map(rule => ({ ...rule, editorial_approved: true }))
    ).binder_id,
    stableSeriesId(20605)
  );
  const partial = new Map([
    [1, media(1, "A Season 3", [[2, "SEQUEL"]])],
    [2, media(2, "A Season 4")]
  ]);
  assert.ok(
    buildSeriesDecisions(partial, [1, 2]).rules.every(
      rule => rule.decision === "B"
    )
  );
});

test("audit never re-keys an already unified season group or infers provenance from its shared label", () => {
  const rows = [
    {
      source: "anilist",
      source_id: "1",
      nom: "Hero",
      franchise: "A",
      franchise_romaji: "A"
    },
    {
      source: "anilist",
      source_id: "2",
      nom: "Other",
      franchise: "A Season 2",
      franchise_romaji: "A Season 2"
    }
  ];
  const state = {
    chars: {
      1: { id: 1, personnage: "Hero" },
      2: { id: 2, personnage: "Other" }
    },
    anime: {
      1: { en: "A", romaji: "A" },
      2: { en: "A Season 2", romaji: "A Season 2" }
    }
  };
  const cards = rows.map((r, i) => ({
    id: String(i + 1),
    source: r.source,
    source_id: r.source_id,
    nom: r.nom.toUpperCase(),
    categorie: "ANIME/MANGA",
    franchise: "A",
    franchise_romaji: r.franchise_romaji,
    links: [{ franchise: "A", position: 0 }]
  }));
  cards.push({ ...cards[0], id: "manual", source: "manual" });
  const options = {
    snapshot: {
      captured_at: "fixture",
      read_only: "on",
      category: "ANIME/MANGA",
      cards,
      favorites: { rows: 0, players: 0, anime_relevant_rows: 0 }
    },
    importRows: rows,
    importState: state,
    mediaCache: {
      entries: {
        1: { media: media(1, "A", [[2, "SEQUEL"]]) },
        2: { media: media(2, "A Season 2") }
      }
    },
    normalizedTitles: { "A Season 2": "A" },
    previousRows: []
  };
  const result = auditAnimeSeries(options);
  assert.equal(result.assignments.length, 0);
  assert.equal(result.summary.licenses_before, 1);
  assert.equal(result.summary.proposed_binders_after, 1);
  assert.equal(result.summary.mixed_origin_binders, 1);
  assert.equal(result.protectedCards[0].origin, "manual");
  const unavailable = auditAnimeSeries({
    ...options,
    mediaCache: { entries: { 1: { media: null }, 2: { media: null } } }
  });
  assert.equal(unavailable.assignments.length, 0);
  assert.equal(unavailable.protectedCards.length, 3);
  assert.match(
    unavailable.protectedCards[0].exclusion_reason,
    /media is unavailable/
  );
});

test("scoped AniList requests deduplicate, resume, respect 429 and exclude unrelated/expired cached data", async () => {
  let time = Date.parse("2026-10-24T12:00:00Z"),
    calls = 0;
  const sleeps = [],
    checkpoints = [];
  const result = await fetchScopedMedia([1, 2, 2], {
    purpose: "Yokkai current Anime/Manga catalogue audit",
    commercialUsageConfirmed: true,
    now: () => time,
    sleep: async ms => {
      sleeps.push(ms);
      time += ms;
    },
    cached: {
      1: { fetched_at: new Date(time).toISOString(), media: { id: 1 } },
      2: {
        fetched_at: new Date(time - 8 * 86400000).toISOString(),
        media: { id: 2 }
      },
      999: { fetched_at: new Date(time).toISOString(), media: { id: 999 } }
    },
    request: async (_url, init) => {
      calls++;
      assert.deepEqual(JSON.parse(init.body).variables.ids, [2]);
      if (calls === 1)
        return new Response("", {
          status: 429,
          headers: { "retry-after": "70" }
        });
      return Response.json({ data: { Page: { media: [{ id: 2 }] } } });
    },
    checkpoint: entries => checkpoints.push(Object.keys(entries))
  });
  assert.equal(calls, 2);
  assert.ok(sleeps.includes(70000));
  assert.deepEqual(Object.keys(result), ["1", "2"]);
  assert.deepEqual(checkpoints, [["1", "2"]]);
  await assert.rejects(
    fetchScopedMedia([1], {
      request: () => {
        throw new Error("must not call");
      }
    }),
    /must be confirmed/
  );
});

test("isolated SQL projection preserves manual cards, other categories, sources, player rows and rollback while distinguishing the two Tokyo series", async t => {
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
  const ids = [1, 2, 3, 4, 5, 6, 7].map(
    n => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  const owner = "95000000-0000-4000-8000-000000000001";
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"SeriesFixture"}\')',
    [owner]
  );
  for (const [i, id] of ids.entries()) {
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,franchise_romaji,rarete_base,image_url,source) values($1,$2,$3,$4,$5,$5,'C','https://example.test/card.png',$6)",
      [
        id,
        String(i + 1),
        `Fixture ${i}`,
        i === 5 ? "VIDEO GAMES" : "ANIME/MANGA",
        i === 3
          ? "Tokyo Ghoul:re"
          : i === 4
            ? "Tokyo Ghoul:re 2nd Season"
            : "Tokyo Ghoul √A",
        i === 1 ? "manual" : "anilist"
      ]
    );
  }
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values($1,'External secondary',1)",
    [ids[0]]
  );
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity,is_shiny) values($1,$2,'LR',true),($1,$2,'C',false)",
    [owner, ids[0]]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values($1,$2)",
    [owner, ids[1]]
  );
  const fingerprint = async () => {
    const values = {};
    for (const table of [
      "cards",
      "card_franchises",
      "card_categories",
      "user_cards",
      "wishlists",
      "user_profiles",
      "panini_album_favorites"
    ])
      values[table] = (
        await db.query(
          `select md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by to_jsonb(x)::text),'')) v from public.${table} x`
        )
      ).rows[0].v;
    return values;
  };
  const before = await fingerprint();
  for (const [id, root, title] of [
    [20605, 20605, "Tokyo Ghoul"],
    [20850, 20605, "Tokyo Ghoul"],
    [100240, 100240, "Tokyo Ghoul:re"],
    [102351, 100240, "Tokyo Ghoul:re"]
  ]) {
    await db.query(
      "insert into public.anime_series_binders values($1,$2,$3) on conflict do nothing",
      [stableSeriesId(root), root, title]
    );
    await db.query(
      "insert into public.anime_series_media_rules values($1,$2,'A',false)",
      [id, stableSeriesId(root)]
    );
  }
  for (const [i, mediaId] of [
    [0, 20850],
    [3, 100240],
    [4, 102351]
  ]) {
    await db.query(
      "insert into public.anime_series_origin_evidence select id,source_id::integer,$2,to_jsonb(c),repeat('a',64) from public.cards c where id=$1",
      [ids[i], mediaId]
    );
    await db.query(
      "insert into public.anime_series_card_assignments select id,franchise,$2 from public.cards where id=$1",
      [ids[i], mediaId]
    );
  }
  await assert.rejects(
    db.query(
      "insert into public.anime_series_origin_evidence select id,source_id::integer,20850,to_jsonb(c),repeat('b',64) from public.cards c where id=$1",
      [ids[1]]
    ),
    /check constraint/
  );
  const links = async () =>
    (
      await db.query(
        "select card_id,source_license,binder_key,display_name from public.anime_series_projected_links where card_id=any($1) order by card_id,source_license",
        [ids]
      )
    ).rows;
  const baseline = await links();
  await db.exec("update public.anime_series_settings set enabled=true");
  assert.deepEqual(
    await links(),
    baseline,
    "Activation alone cannot apply unapproved rules"
  );
  await db.exec(
    "update public.anime_series_media_rules set editorial_approved=true"
  );
  const projected = await links();
  for (const i of [1, 2, 5, 6])
    assert.deepEqual(
      projected.filter(l => l.card_id === ids[i]),
      baseline.filter(l => l.card_id === ids[i]),
      `Protected or other-category card ${i}`
    );
  assert.equal(
    projected.find(
      l => l.card_id === ids[0] && l.source_license === "Tokyo Ghoul √A"
    ).display_name,
    "Tokyo Ghoul"
  );
  assert.equal(
    projected.find(l => l.card_id === ids[3]).binder_key,
    projected.find(l => l.card_id === ids[4]).binder_key
  );
  assert.notEqual(
    projected.find(l => l.card_id === ids[0]).binder_key,
    projected.find(l => l.card_id === ids[3]).binder_key
  );
  assert.deepEqual(
    projected.find(l => l.source_license === "External secondary"),
    baseline.find(l => l.source_license === "External secondary")
  );
  assert.deepEqual(await fingerprint(), before);
  await db.exec("set role authenticated");
  await assert.rejects(
    db.exec("update public.anime_series_settings set enabled=false"),
    /permission denied/
  );
  await db.exec("reset role");
  await db.query(
    "update public.cards set description='Later operator edit' where id=$1",
    [ids[0]]
  );
  assert.deepEqual(
    (await links()).filter(l => l.card_id === ids[0]),
    baseline.filter(l => l.card_id === ids[0]),
    "Stale evidence must protect an edited card"
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/recipes/disable_anime_series_projection.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.deepEqual(await links(), baseline);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.user_cards where user_id=$1",
        [owner]
      )
    ).rows[0].n,
    2
  );
  await db.exec("create table public.global_binder_settings(id integer)");
  await assert.rejects(
    db.exec(
      readFileSync(
        new URL(
          "../supabase/recipes/anime_series_projection.sql",
          import.meta.url
        ),
        "utf8"
      )
    ),
    /ANIME_SERIES_PREVIOUS_PROJECTION_PRESENT/
  );
  await db.exec("rollback");
});
