import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  indexLicenseNameCandidates,
  normalizedLicenseName,
  boundedNameDistance
} from "../scripts/anime-license-name-index.mjs";
import {
  buildV3SeriesDecisions,
  V3_REVIEW
} from "../scripts/anime-series-v3-decisions.mjs";
import { stableSeriesId, sha256 } from "../scripts/anime-series-provenance.mjs";
import { auditAnimeSeries } from "../scripts/audit-anime-series.mjs";
import { collectLicenseInventory } from "../scripts/audit-anime-license-names.mjs";

test("name index discovers full-token prefixes, seasons, punctuation and verified media aliases without changing input or approving merges", () => {
  const input = [
    { name: "Demon Slayer", known_media_ids: [101922] },
    { name: "Demon Slayer: Swordsmith Village Arc", known_media_ids: [145139] },
    { name: "DEMON SLAYER", known_media_ids: [101922] },
    {
      name: "Kimetsu no Yaiba",
      known_media_ids: [101922],
      prefix_aliases: ["Demon Slayer: Kimetsu no Yaiba"]
    },
    { name: "Tokyo Ghoul", known_media_ids: [20605] },
    { name: "Tokyo Ghoul:re", known_media_ids: [100240] },
    { name: "Naruto" },
    { name: "Narutoland" },
    { name: "Haganai" },
    { name: "Haganai 2nd Season" },
    { name: "Pokémon" },
    { name: "Pokemon" },
    { name: "Movie edition: Demon Slayer" }
  ];
  const before = structuredClone(input),
    result = indexLicenseNameCandidates(input);
  const groups = kind =>
    result.groups
      .filter(g => g.kind === kind)
      .map(g => g.license_indexes.map(i => result.licenses[i].name));
  assert.ok(
    groups("CONTAINED_SOURCE_TITLE").some(
      g =>
        g.includes("Demon Slayer") && g.includes("Movie edition: Demon Slayer")
    )
  );
  assert.ok(
    groups("TITLE_PREFIX").some(
      g =>
        g.includes("Demon Slayer") &&
        g.includes("Demon Slayer: Swordsmith Village Arc")
    )
  );
  assert.ok(
    groups("TITLE_PREFIX").some(
      g => g.includes("Tokyo Ghoul") && g.includes("Tokyo Ghoul:re")
    )
  );
  assert.ok(
    !groups("TITLE_PREFIX").some(
      g => g.includes("Naruto") && g.includes("Narutoland")
    )
  );
  assert.ok(
    groups("SAME_IMPORTED_MEDIA_ALIAS").some(
      g => g.includes("Kimetsu no Yaiba") && g.includes("Demon Slayer")
    )
  );
  assert.ok(
    groups("ORTHOGRAPHY_SPACING_PUNCTUATION").some(
      g => g.includes("Pokémon") && g.includes("Pokemon")
    )
  );
  assert.ok(
    groups("SEASON_PART_STEM").some(
      g => g.includes("Haganai") && g.includes("Haganai 2nd Season")
    )
  );
  assert.deepEqual(input, before);
  assert.ok(!("assignments" in result));
});

test("spelling index matches an independent edit-distance oracle on bounded synthetic names and avoids a full pair matrix", () => {
  const distance = (a, b) => {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(
          row[j] + 1,
          next[j - 1] + 1,
          row[j - 1] + Number(a[i - 1] !== b[j - 1])
        );
      row = next;
    }
    return row[b.length];
  };
  const names = [
    "Komaneko",
    "KomanekoX",
    "KomanekoXY",
    "Komaenko",
    "Komoneko",
    ...Array.from({ length: 350 }, (_, i) =>
      createHash("sha256").update(`fixture ${i}`).digest("hex").slice(0, 24)
    )
  ];
  const result = indexLicenseNameCandidates(names.map(name => ({ name })));
  const found = new Set(
    result.groups
      .filter(g => g.kind === "SPELLING_DISTANCE")
      .map(g =>
        g.license_indexes
          .map(i => result.licenses[i].name)
          .sort()
          .join("|")
      )
  );
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = normalizedLicenseName(names[i]),
        b = normalizedLicenseName(names[j]);
      assert.equal(boundedNameDistance(a, b, 2) <= 2, distance(a, b) <= 2);
      if (distance(a, b) <= 2)
        assert.ok(found.has([names[i], names[j]].sort().join("|")));
    }
  assert.ok(
    result.metrics.bounded_distance_checks <
      result.metrics.all_possible_license_pairs / 10
  );
});

const fixture = id => ({
  id,
  type: "ANIME",
  format: "TV",
  title: { english: `Media ${id}`, romaji: `Media ${id}` },
  startDate: { year: 2020 },
  relations: { edges: [] }
});

test("short spelling candidates need no shared trigram and do not depend on input order", () => {
  for (const names of [
    ["Air", "Ai", "Aura", "Aria"],
    ["Aria", "Aura", "Ai", "Air"]
  ]) {
    const result = indexLicenseNameCandidates(names.map(name => ({ name })));
    const pairs = result.groups
      .filter(g => g.kind === "SPELLING_DISTANCE")
      .map(g =>
        g.license_indexes
          .map(i => result.licenses[i].name)
          .sort()
          .join("|")
      );
    assert.ok(pairs.includes(["Air", "Ai"].sort().join("|")));
    assert.ok(result.metrics.short_name_trie_visits > 0);
  }
});
const previous = ids =>
  ids.map(id => ({
    media_id: id,
    series_media_id: id,
    binder_id: stableSeriesId(id),
    display_name: `Media ${id}`,
    decision: "C",
    editorial_approved: false,
    production_approved: false
  }));
test("V3 reunites verified indirect seasons and corrects the two Gaiden runs while keeping major series apart", () => {
  const ids = [
    10719, 14967, 3974, 5074, 566, 3371, 3665, 820, 20628, 20605, 20850, 100240,
    102351, 481, 482, 550, 3972, 10015, 20552, 98231, 114072, 142842
  ];
  const rules = buildV3SeriesDecisions(
    new Map(ids.map(id => [id, fixture(id)])),
    ids,
    previous(ids)
  ).rules;
  const binder = id => rules.find(r => r.media_id === id).binder_id;
  for (const [a, b] of [
    [10719, 14967],
    [3974, 5074],
    [3371, 3665],
    [20605, 20850],
    [100240, 102351]
  ])
    assert.equal(binder(a), binder(b));
  for (const [a, b] of [
    [3974, 566],
    [3371, 820],
    [3371, 20628],
    [20605, 100240],
    [481, 550],
    [481, 482]
  ])
    assert.notEqual(binder(a), binder(b));
  assert.equal(
    new Set(
      [481, 482, 550, 3972, 10015, 20552, 98231, 114072, 142842].map(binder)
    ).size,
    9
  );
  assert.ok(rules.every(r => !r.editorial_approved && !r.production_approved));
});
test("V3 cannot cross mandatory Tokyo or Yu-Gi-Oh boundaries even through an explicit-looking review group", () => {
  for (const ids of [
    [20605, 100240],
    [481, 482]
  ]) {
    const review = {
      ...V3_REVIEW,
      groups: [
        {
          review_id: "INVALID",
          name: "Invalid group",
          root_media_id: ids[0],
          media_ids: ids,
          reason: "Synthetic invalid bridge",
          evidence_urls: ["https://example.test"],
          editorial_approved: false,
          production_approved: false
        }
      ]
    };
    assert.throws(
      () =>
        buildV3SeriesDecisions(
          new Map(ids.map(id => [id, fixture(id)])),
          ids,
          previous(ids),
          review
        ),
      /boundary/
    );
  }
});
test("JoJo manual cards retain distinct exact displayed source binders despite a shared anime identity candidate", () => {
  const names = [
    "JoJo's Bizarre Adventure: Phantom Blood",
    "JoJo's Bizarre Adventure: Battle Tendency"
  ];
  const cards = names.map((franchise, i) => ({
    id: `manual-${i}`,
    source: "manual",
    source_id: String(10 + i),
    nom: `Manual ${i}`,
    categorie: "ANIME/MANGA",
    franchise,
    franchise_romaji: "JoJo no Kimyou na Bouken",
    links: [{ franchise, position: 0 }],
    categories: ["ANIME/MANGA"]
  }));
  const audit = auditAnimeSeries({
    snapshot: {
      read_only: "on",
      category: "ANIME/MANGA",
      captured_at: "fixture",
      cards,
      favorites: { rows: 0, players: 0, anime_relevant_rows: 0 }
    },
    importRows: [],
    importState: { chars: {}, anime: {} },
    mediaCache: { entries: { 14719: { media: fixture(14719) } } },
    normalizedTitles: {},
    reviewV3: true,
    previousRules: previous([14719])
  });
  assert.equal(audit.assignments.length, 0);
  assert.equal(audit.protectedCards.length, 2);
  assert.deepEqual(
    audit.projected.map(r => r.binder_key).sort(),
    names
      .map(
        name =>
          "source:" + sha256("ANIME/MANGA" + String.fromCharCode(31) + name)
      )
      .sort()
  );
  assert.deepEqual(
    cards.map(c => c.franchise),
    names
  );
});

test("license inventory includes protected and secondary-only licenses without assigning the primary media to a secondary link", () => {
  const snapshot = {
    read_only: "on",
    category: "ANIME/MANGA",
    cards: [
      {
        id: "verified",
        franchise: "Primary Work",
        links: [
          { franchise: "Primary Work", position: 0 },
          { franchise: "Secondary-only label", position: 1 }
        ]
      },
      {
        id: "manual",
        franchise: "Manual Work",
        links: [{ franchise: "Manual Work", position: 0 }]
      },
      {
        id: "edited",
        franchise: "Primary Work: local edit",
        links: [{ franchise: "Primary Work: local edit", position: 0 }]
      }
    ]
  };
  const matches = [
    {
      card_id: "verified",
      origin: "anilist_confirmed",
      eligible: true,
      media_id: 10719
    },
    { card_id: "manual", origin: "manual", eligible: false, media_id: null },
    {
      card_id: "edited",
      origin: "anilist_confirmed",
      eligible: false,
      media_id: 14967
    }
  ];
  const inventory = collectLicenseInventory(snapshot, matches, {
    entries: {
      10719: { media: fixture(10719) },
      14967: { media: fixture(14967) }
    }
  });
  const byName = new Map(inventory.map(r => [r.name, r]));
  assert.equal(inventory.length, 4);
  assert.deepEqual(byName.get("Primary Work").eligible_media_ids, [10719]);
  assert.deepEqual(byName.get("Secondary-only label").eligible_media_ids, []);
  assert.deepEqual(byName.get("Secondary-only label").known_media_ids, []);
  assert.deepEqual(byName.get("Secondary-only label").secondary_card_ids, [
    "verified"
  ]);
  assert.deepEqual(byName.get("Manual Work").protected_card_ids, ["manual"]);
  assert.deepEqual(
    byName.get("Primary Work: local edit").eligible_media_ids,
    []
  );
  assert.deepEqual(
    byName.get("Primary Work: local edit").known_media_ids,
    [14967]
  );
  assert.throws(
    () => collectLicenseInventory(snapshot, matches.slice(1), { entries: {} }),
    /Every catalogue card/
  );
});
