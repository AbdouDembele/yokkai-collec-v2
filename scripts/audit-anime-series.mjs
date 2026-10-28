import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "csv-parse/sync";
import {
  classifyOrigin,
  importIndex,
  mediaTitleIndex,
  resolveImportedMedia,
  identityText,
  sha256
} from "./anime-series-provenance.mjs";
import { buildSeriesDecisions } from "./anime-series-decisions.mjs";
import { buildV2SeriesDecisions } from "./anime-series-v2-decisions.mjs";
import { buildV3SeriesDecisions } from "./anime-series-v3-decisions.mjs";

export function auditAnimeSeries({
  snapshot,
  importRows,
  importState,
  mediaCache,
  normalizedTitles,
  previousRows = [],
  reviewV2 = false,
  reviewV3 = false,
  previousRules = []
}) {
  if (snapshot.read_only !== "on" || snapshot.category !== "ANIME/MANGA")
    throw new Error("Expected a fresh read-only Anime/Manga snapshot.");
  const records = importIndex(importRows),
    titles = mediaTitleIndex(importState);
  const mediaById = new Map(
    Object.entries(mediaCache.entries)
      .filter(([, entry]) => entry.media)
      .map(([id, entry]) => [Number(id), entry.media])
  );
  const origins = [],
    matches = [],
    protectedCards = [],
    cardById = new Map(),
    bySource = new Map();
  const norm = value => identityText(value).toLowerCase();
  for (const card of snapshot.cards) {
    if (card.categorie !== "ANIME/MANGA")
      throw new Error("Out-of-category row in audit snapshot");
    cardById.set(card.id, card);
    const origin = classifyOrigin(card, records, importState),
      match = resolveImportedMedia(card, origin, titles);
    const media = mediaById.get(match.media_id);
    const permittedTitle = origin.record
      ? [origin.record.franchise, origin.record.franchise_romaji]
          .filter(Boolean)
          .flatMap(name => [name, normalizedTitles[name]])
          .filter(Boolean)
      : [];
    let eligible = Boolean(
      media && media.type === "ANIME" && origin.origin === "anilist_confirmed"
    );
    let exclusion = match.reason;
    if (match.media_id && !media)
      exclusion =
        "AniList media is unavailable for the imported identity; protect until verified.";
    if (
      eligible &&
      ![
        media.title.romaji,
        media.title.english,
        ...(media.synonyms ?? [])
      ].some(
        name =>
          name &&
          [origin.record.franchise_romaji, origin.record.franchise].some(
            old => norm(name) === norm(old)
          )
      )
    ) {
      eligible = false;
      exclusion =
        "Current AniList titles no longer corroborate the exact imported work; review required.";
    }
    if (eligible && !permittedTitle.includes(card.franchise)) {
      eligible = false;
      exclusion =
        "Primary license changed beyond the verified historical normalizer; protect local edit.";
    }
    const item = {
      card_id: card.id,
      source: card.source,
      source_id: card.source_id,
      source_license: card.franchise,
      source_romaji: card.franchise_romaji,
      origin: origin.origin,
      origin_reason: origin.reason,
      character_id: origin.character_id ?? null,
      media_id: match.media_id,
      eligible,
      exclusion_reason: eligible ? "" : exclusion
    };
    origins.push(item);
    matches.push({
      ...item,
      anilist_url: media?.siteUrl ?? "",
      english: media?.title.english ?? "",
      romaji: media?.title.romaji ?? "",
      native: media?.title.native ?? "",
      format: media?.format ?? "",
      year: media?.seasonYear ?? media?.startDate?.year ?? "",
      season: media?.season ?? ""
    });
    if (!eligible)
      protectedCards.push({
        ...item,
        card_name: card.nom,
        protected_links: card.links.map(link => link.franchise).join(" | ")
      });
    for (const link of card.links) {
      const group = bySource.get(link.franchise) ?? {
        license: link.franchise,
        cards: new Set(),
        origins: new Map(),
        media: new Set(),
        manual: 0,
        unknown: 0,
        confirmed: 0
      };
      group.cards.add(card.id);
      group.origins.set(card.id, origin.origin);
      if (origin.origin === "manual") group.manual++;
      else if (origin.origin === "unknown") group.unknown++;
      else if (origin.origin === "anilist_confirmed") group.confirmed++;
      if (link.franchise === card.franchise && eligible)
        group.media.add(match.media_id);
      bySource.set(link.franchise, group);
    }
  }
  const represented = [
    ...new Set(origins.filter(row => row.eligible).map(row => row.media_id))
  ];
  const { rules, pairs } = reviewV3
    ? buildV3SeriesDecisions(mediaById, represented, previousRules)
    : reviewV2
      ? buildV2SeriesDecisions(mediaById, represented, previousRules)
      : buildSeriesDecisions(mediaById, represented);
  const ruleByMedia = new Map(rules.map(rule => [rule.media_id, rule]));
  // Multiple stored labels for one verified media can be proposed as identity aliases.
  const labelsByMedia = new Map();
  for (const row of origins.filter(row => row.eligible)) {
    const set = labelsByMedia.get(row.media_id) ?? new Set();
    set.add(row.source_license);
    labelsByMedia.set(row.media_id, set);
  }
  for (const rule of rules)
    if (labelsByMedia.get(rule.media_id)?.size > 1 && rule.decision === "C") {
      rule.decision = "A";
      rule.reason =
        "Multiple source labels for the same verified media identity.";
    }
  const labelsByBinder = new Map();
  for (const row of origins.filter(row => row.eligible)) {
    const rule = ruleByMedia.get(row.media_id);
    if (rule?.decision !== "A") continue;
    const labels = labelsByBinder.get(rule.binder_id) ?? new Set();
    labels.add(row.source_license);
    labelsByBinder.set(rule.binder_id, labels);
  }
  const assignments = [],
    proposals = new Map();
  for (const row of origins) {
    const rule = ruleByMedia.get(row.media_id),
      card = cardById.get(row.card_id);
    if (!row.eligible || rule?.decision !== "A") continue;
    // A season group already stored under one label does not need to move.
    // Re-keying only part of such a group would manufacture new fragmentation.
    if (
      !reviewV2 &&
      !reviewV3 &&
      (labelsByBinder.get(rule.binder_id)?.size ?? 0) < 2
    )
      continue;
    if (!card.links.some(link => link.franchise === row.source_license))
      continue;
    const verifiedSnapshot = Object.fromEntries(
      Object.entries(card).filter(
        ([key]) => !["links", "categories"].includes(key)
      )
    );
    assignments.push({
      card_id: card.id,
      source_license: row.source_license,
      character_id: row.character_id,
      media_id: row.media_id,
      binder_id: rule.binder_id,
      verified_snapshot: verifiedSnapshot,
      import_evidence_sha256: sha256(
        JSON.stringify([
          originEvidence(records.get(card.source_id)),
          importState.chars[card.source_id]
        ])
      )
    });
    const key = JSON.stringify([
      row.source_license,
      row.media_id,
      rule.binder_id
    ]);
    const proposal = proposals.get(key) ?? {
      source_license: row.source_license,
      target_binder: rule.display_name,
      binder_id: rule.binder_id,
      series_media_id: rule.series_media_id,
      media_id: row.media_id,
      decision: "A",
      confidence: "high_candidate_pending_editorial_review",
      validation_status: "PROPOSED_NOT_APPROVED",
      justification: rule.reason,
      anilist_relations: pairs
        .filter(
          pair =>
            pair.status === "A" &&
            [pair.source_media_id, pair.target_media_id].includes(row.media_id)
        )
        .map(
          pair =>
            `${pair.source_media_id}:${pair.relation}:${pair.target_media_id}`
        )
        .join(" | "),
      cards: 0
    };
    proposal.cards++;
    proposals.set(key, proposal);
  }
  const assignmentByLink = new Map(
    assignments.map(row => [
      JSON.stringify([row.card_id, row.source_license]),
      row
    ])
  );
  const projected = new Map(),
    rawPairs = new Set();
  let changedCards = new Set();
  for (const card of snapshot.cards)
    for (const link of card.links) {
      const assignment = assignmentByLink.get(
        JSON.stringify([card.id, link.franchise])
      );
      const key = assignment
        ? `series:${assignment.binder_id}`
        : `source:${sha256(card.categorie + String.fromCharCode(31) + link.franchise)}`;
      const value = projected.get(key) ?? new Set();
      value.add(card.id);
      projected.set(key, value);
      rawPairs.add(JSON.stringify([card.id, link.franchise]));
      if (assignment) changedCards.add(card.id);
    }
  const mixed = [...bySource.values()]
    .filter(row => new Set(row.origins.values()).size > 1)
    .map(row => ({
      source_license: row.license,
      cards: row.cards.size,
      anilist_confirmed: row.confirmed,
      manual: row.manual,
      unknown: row.unknown,
      action:
        "Per-card evidence only; retain protected source binder and stable series binder separately even if labels coincide."
    }));
  const previous = new Map(previousRows.map(row => [row.source, row]));
  const conflicts = [];
  for (const [source, group] of bySource) {
    const old = previous.get(source);
    if (!old || old.decision !== "propose") continue;
    const proposed = [
      ...new Set(
        [...group.media]
          .map(id => ruleByMedia.get(id))
          .filter(Boolean)
          .map(rule => (rule.decision === "A" ? rule.display_name : source))
      )
    ];
    if (
      proposed.length !== 1 ||
      proposed[0] !== old.target ||
      group.manual ||
      group.unknown
    )
      conflicts.push({
        source_license: source,
        previous_target: old.target,
        new_targets: proposed.join(" | ") || source,
        protected_cards: group.manual + group.unknown,
        reason:
          "Previous franchise-wide/name-only rule is superseded; no automatic transformation for B/C/D or unverified origins.",
        action: "Do not combine old PR #481 with this proposal."
      });
  }
  const relevantPairs = pairs.map(pair => ({
    ...pair,
    source_title:
      mediaById.get(pair.source_media_id)?.title.english ??
      mediaById.get(pair.source_media_id)?.title.romaji,
    target_title:
      mediaById.get(pair.target_media_id)?.title.english ??
      mediaById.get(pair.target_media_id)?.title.romaji,
    transformation_allowed: false
  }));
  const lexical = new Map();
  for (const source of bySource.keys()) {
    const key = norm(source).replace(/[\p{P}\p{S}\s]+/gu, "");
    const list = lexical.get(key) ?? [];
    list.push(source);
    lexical.set(key, list);
  }
  const variantCandidates = [...lexical.values()].filter(
    list => list.length > 1
  );
  const preexistingMixedSeries = [...bySource.values()]
    .filter(
      group =>
        new Set(
          [...group.media].map(
            id => ruleByMedia.get(id)?.binder_id ?? `media:${id}`
          )
        ).size > 1
    )
    .map(group => ({
      source_license: group.license,
      media_ids: [...group.media],
      reason:
        "Existing source label already contains multiple series/media; do not repair historical metadata without separate review."
    }));
  const counts = Object.fromEntries(
    ["anilist_confirmed", "manual", "unknown"].map(origin => [
      origin,
      origins.filter(row => row.origin === origin).length
    ])
  );
  const summary = {
    captured_at: snapshot.captured_at,
    category: "ANIME/MANGA",
    cards: snapshot.cards.length,
    licenses_before: bySource.size,
    proposed_binders_after: projected.size,
    proposed_unique_card_binder_links: [...projected.values()].reduce(
      (sum, set) => sum + set.size,
      0
    ),
    original_source_links: rawPairs.size,
    origin_counts: counts,
    protected_cards: protectedCards.length,
    confirmed_without_safe_media_link: protectedCards.filter(
      row => row.origin === "anilist_confirmed"
    ).length,
    mixed_origin_binders: mixed.length,
    lexical_variant_candidate_groups: variantCandidates.length,
    direct_season_relation_pairs: pairs.filter(row => row.status === "A")
      .length,
    already_grouped_season_components: [...labelsByBinder.values()].filter(
      labels => labels.size === 1
    ).length,
    proposed_mapping_rows: proposals.size,
    proposed_series_groups: new Set(
      [...proposals.values()].map(row => row.binder_id)
    ).size,
    assigned_cards_in_simulation: changedCards.size,
    ambiguous_relation_pairs: pairs.filter(row => row.status === "B").length,
    ambiguous_media_rules: rules.filter(row => row.decision === "B").length,
    keep_separate_relation_pairs: pairs.filter(row => row.status === "C")
      .length,
    excluded_relations: pairs.filter(row => row.status === "D").length,
    previous_mapping_conflicts: conflicts.length,
    preexisting_multi_series_source_labels: preexistingMixedSeries.length,
    favorites_reset_proposed: false,
    favorite_rows_total: snapshot.favorites.rows,
    favorite_rows_anime_relevant: snapshot.favorites.anime_relevant_rows,
    favorite_players_total: snapshot.favorites.players,
    production_changes: false,
    editorial_approved: false,
    activation_authorized: false,
    api_scope_media: Object.keys(mediaCache.entries).length,
    api_missing_media: Object.values(mediaCache.entries).filter(
      entry => !entry.media
    ).length
  };
  return {
    summary,
    matches,
    protectedCards,
    mixed,
    conflicts,
    proposals: [...proposals.values()],
    rules,
    assignments,
    pairs: relevantPairs,
    variantCandidates,
    preexistingMixedSeries,
    projected: [...projected].map(([binder_key, ids]) => ({
      binder_key,
      total: ids.size
    }))
  };
}

function originEvidence(row) {
  return row
    ? {
        source: row.source,
        source_id: row.source_id,
        nom: row.nom,
        franchise: row.franchise,
        franchise_romaji: row.franchise_romaji
      }
    : null;
}
const readJSON = path =>
  JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const csv = rows => {
  if (!rows.length) return "status\r\nNO_ROWS\r\n";
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const cell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [
      keys.map(cell).join(";"),
      ...rows.map(row =>
        keys
          .map(key =>
            cell(
              typeof row[key] === "object" ? JSON.stringify(row[key]) : row[key]
            )
          )
          .join(";")
      )
    ].join("\r\n") +
    "\r\n"
  );
};

async function main() {
  const { values } = parseArgs({
    options: {
      ...Object.fromEntries(
        [
          "snapshot",
          "import-csv",
          "import-state",
          "media-cache",
          "normalized-titles",
          "previous-mapping",
          "output",
          "baseline-v1",
          "baseline-v2"
        ].map(key => [key, { type: "string" }])
      ),
      "review-v2": { type: "boolean", default: false },
      "review-v3": { type: "boolean", default: false }
    }
  });
  for (const key of [
    "snapshot",
    "import-csv",
    "import-state",
    "media-cache",
    "normalized-titles",
    "output"
  ])
    if (!values[key]) throw new Error(`Missing --${key}`);
  if (values["review-v2"] && !values["baseline-v1"])
    throw new Error(
      "V2 requires --baseline-v1 to preserve published binder identities"
    );
  if (values["review-v2"] && values["review-v3"])
    throw new Error("Select one audit revision");
  if (
    values["review-v3"] &&
    (!values["baseline-v2"] ||
      readJSON(values["baseline-v2"]).schema_version !== 2)
  )
    throw new Error("V3 requires --baseline-v2 with the unchanged V2 manifest");
  const snapshot = readJSON(values.snapshot),
    output = resolve(values.output);
  const audit = auditAnimeSeries({
    snapshot,
    importRows: parse(readFileSync(values["import-csv"], "utf8"), {
      columns: true,
      bom: true,
      skip_empty_lines: true
    }),
    importState: readJSON(values["import-state"]),
    mediaCache: readJSON(values["media-cache"]),
    normalizedTitles: readJSON(values["normalized-titles"]),
    reviewV2: values["review-v2"],
    reviewV3: values["review-v3"],
    previousRules: values["review-v3"]
      ? readJSON(values["baseline-v2"]).media_rules
      : values["baseline-v1"]
        ? readJSON(values["baseline-v1"]).media_rules
        : [],
    previousRows: values["previous-mapping"]
      ? readJSON(values["previous-mapping"]).rows
      : []
  });
  mkdirSync(output, { recursive: true });
  for (const [file, rows] of Object.entries({
    "anilist_matches.csv": audit.matches,
    "proposed_merges.csv": audit.proposals,
    "keep_separate.csv": [
      ...audit.pairs.filter(row => row.status === "C"),
      ...audit.rules
        .filter(row => row.decision === "C")
        .map(row => ({
          source_media_id: row.media_id,
          target_media_id: row.series_media_id,
          source_title: row.display_name,
          status: "C",
          reason: row.reason,
          transformation_allowed: false
        }))
    ],
    "manual_imports_protected.csv": audit.protectedCards,
    "mixed_origin_conflicts.csv": audit.mixed,
    "conflicts_with_previous_mapping.csv": audit.conflicts,
    "ambiguous_matches.csv": [
      ...audit.pairs.filter(row => row.status === "B"),
      ...audit.rules
        .filter(row => row.decision === "B")
        .map(row => ({
          source_media_id: row.media_id,
          target_media_id: row.series_media_id,
          source_title: row.display_name,
          status: "B",
          reason: row.reason,
          transformation_allowed: false
        }))
    ],
    "lexical_candidates_not_merges.csv": audit.variantCandidates.map(names => ({
      licenses: names.join(" | "),
      action: "Discovery only; no merge from normalized text."
    })),
    "preexisting_series_conflicts.csv": audit.preexistingMixedSeries
  }))
    writeFileSync(join(output, file), csv(rows));
  const manifest = {
    schema_version: values["review-v3"] ? 3 : values["review-v2"] ? 2 : 1,
    policy: "one_identifiable_series_per_binder",
    category: "ANIME/MANGA",
    snapshot_at: snapshot.captured_at,
    editorial_approved: false,
    production_approved: false,
    default_enabled: false,
    summary: audit.summary,
    media_rules: audit.rules,
    assignments: audit.assignments
  };
  writeFileSync(
    join(output, "mapping_anime_manga.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  writeFileSync(
    join(output, "summary.json"),
    JSON.stringify(audit.summary, null, 2) + "\n"
  );
  writeFileSync(
    join(output, "expected_binder_counts.json"),
    JSON.stringify(audit.projected, null, 2) + "\n"
  );
  writeFileSync(
    join(output, "input_checksums.json"),
    JSON.stringify(
      {
        ...(values["review-v3"]
          ? {
              "anime-series-v3-groups.json": sha256(
                readFileSync(
                  new URL(
                    "../data/editorial/anime-series-v3-groups.json",
                    import.meta.url
                  )
                )
              )
            }
          : {}),
        ...Object.fromEntries(
          Object.entries(values)
            .filter(
              ([key, value]) => key !== "output" && typeof value === "string"
            )
            .map(([key, path]) => [key, sha256(readFileSync(path))])
        ),
        ...(values["review-v2"] || values["review-v3"]
          ? Object.fromEntries(
              [
                "anime-series-v2-review.json",
                "anime-series-v2-groups.json",
                "anime-series-v2-tv-review.json"
              ].map(file => [
                file,
                sha256(
                  readFileSync(
                    new URL(`../data/editorial/${file}`, import.meta.url)
                  )
                )
              ])
            )
          : {})
      },
      null,
      2
    ) + "\n"
  );
  console.log(JSON.stringify(audit.summary, null, 2));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
