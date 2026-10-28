import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "csv-parse/sync";
import {
  indexLicenseNameCandidates,
  normalizedLicenseName,
  compactLicenseName,
  seasonNameStem
} from "./anime-license-name-index.mjs";
import { V3_REVIEW } from "./anime-series-v3-decisions.mjs";
import { V2_REVIEW, V2_TV_REVIEW } from "./anime-series-v2-decisions.mjs";
import { sha256 } from "./anime-series-provenance.mjs";

export function collectLicenseInventory(snapshot, matches, mediaCache) {
  if (snapshot.read_only !== "on" || snapshot.category !== "ANIME/MANGA")
    throw new Error("Read-only Anime/Manga snapshot required");
  const byCard = new Map(matches.map(row => [row.card_id, row])),
    inventory = new Map();
  const add = (set, value) => {
    if (value) set.add(value);
  };
  for (const card of snapshot.cards) {
    const match = byCard.get(card.id);
    if (!match) throw new Error("Every catalogue card needs an audited origin");
    const eligible = match.eligible === true || match.eligible === "true";
    for (const link of card.links) {
      let row = inventory.get(link.franchise);
      if (!row)
        inventory.set(
          link.franchise,
          (row = {
            name: link.franchise,
            card_ids: new Set(),
            manual_card_ids: new Set(),
            unknown_card_ids: new Set(),
            protected_card_ids: new Set(),
            secondary_card_ids: new Set(),
            known_media_ids: new Set(),
            eligible_media_ids: new Set(),
            aliases: new Set(),
            prefix_aliases: new Set()
          })
        );
      row.card_ids.add(card.id);
      if (match.origin === "manual") row.manual_card_ids.add(card.id);
      if (match.origin === "unknown") row.unknown_card_ids.add(card.id);
      if (!eligible) row.protected_card_ids.add(card.id);
      if (link.franchise !== card.franchise) {
        row.secondary_card_ids.add(card.id);
        continue;
      }
      const id = Number(match.media_id);
      if (!Number.isSafeInteger(id) || id < 1) continue;
      row.known_media_ids.add(id);
      if (eligible) row.eligible_media_ids.add(id);
      const media = mediaCache.entries[id]?.media;
      if (!media) continue;
      for (const name of [media.title.english, media.title.romaji])
        add(row.prefix_aliases, name);
      for (const name of [
        media.title.english,
        media.title.romaji,
        media.title.native,
        ...(media.synonyms ?? [])
      ])
        add(row.aliases, name);
    }
  }
  return [...inventory.values()].map(row =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Set ? [...value] : value
      ])
    )
  );
}
const readJSON = file =>
  JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const csv = rows => {
  if (!rows.length) return "status\r\nNO_ROWS\r\n";
  const keys = [...new Set(rows.flatMap(Object.keys))],
    cell = v =>
      `"${String(typeof v === "object" ? JSON.stringify(v) : (v ?? "")).replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [
      keys.map(cell).join(";"),
      ...rows.map(row => keys.map(k => cell(row[k])).join(";"))
    ].join("\r\n") +
    "\r\n"
  );
};
export function auditLicenseNames({
  snapshot,
  matches,
  mediaCache,
  mappingV2,
  mappingV3
}) {
  const inventory = collectLicenseInventory(snapshot, matches, mediaCache),
    started = performance.now();
  const index = indexLicenseNameCandidates(inventory);
  index.metrics.elapsed_ms = Math.round(performance.now() - started);
  const r2 = new Map(mappingV2.media_rules.map(r => [r.media_id, r])),
    r3 = new Map(mappingV3.media_rules.map(r => [r.media_id, r]));
  const additions = new Map(
    V3_REVIEW.groups.flatMap(g => g.media_ids.map(id => [id, g]))
  );
  const groupMemberships = [],
    byLicense = new Map();
  const summaries = index.groups.map(group => {
    const licenses = group.license_indexes.map(i => index.licenses[i]);
    const media = [...new Set(licenses.flatMap(l => l.eligible_media_ids))],
      known = [...new Set(licenses.flatMap(l => l.known_media_ids))];
    const before = new Set(
        media.map(id => r2.get(id)?.binder_id).filter(Boolean)
      ),
      after = new Set(media.map(id => r3.get(id)?.binder_id).filter(Boolean));
    const newGroups = [
      ...new Set(media.map(id => additions.get(id)?.review_id).filter(Boolean))
    ];
    let decision, reason;
    if (group.generic_prefix) {
      decision = "EXCLUDED_GRAMMATICAL_PREFIX";
      reason = `The shared prefix '${group.key}' is grammatical vocabulary, not a series identity. Narrower title-prefix groups are reviewed separately.`;
    } else if (!media.length) {
      decision = "PROTECTED_OR_UNPROVEN_SOURCE";
      reason =
        "No safely eligible primary media exists in this source group. Manual/unknown/locally edited cards retain their exact source binders. Known API names are discovery metadata only.";
    } else if (after.size === 1) {
      decision =
        before.size > 1
          ? "ADDITIONAL_CONFIRMED_GROUP"
          : "ALREADY_GROUPED_OR_SINGLE_SERIES";
      reason =
        before.size > 1
          ? `Exact eligible media now share the explicitly reviewed ${r3.get(media[0]).display_name} identity; names only discovered this candidate.`
          : "All eligible media already resolve to one identifiable series; preserve protected source cards and secondary links separately. No title-wide mutation.";
    } else {
      decision = newGroups.length
        ? "MIXED_GROUP_WITH_EXCLUDED_BRANCHES"
        : "KEEP_DISTINCT_OR_UNCONFIRMED";
      reason = `The shared name/prefix '${group.key}' spans ${after.size} distinct verified media-series identities. Apply only exact reviewed subgroups; no franchise, translation or spelling closure. Each source and member media is listed in name_group_members.csv.`;
    }
    for (const [i, license] of licenses.entries()) {
      const set = byLicense.get(license.name) ?? new Set();
      set.add(group.group_id);
      byLicense.set(license.name, set);
      groupMemberships.push({
        group_id: group.group_id,
        kind: group.kind,
        search_key: group.key,
        license: license.name,
        cards: license.card_ids.length,
        manual: license.manual_card_ids.length,
        unknown: license.unknown_card_ids.length,
        protected: license.protected_card_ids.length,
        secondary_links: license.secondary_card_ids.length,
        known_media_ids: license.known_media_ids,
        eligible_media_ids: license.eligible_media_ids,
        v2_binders: [
          ...new Set(
            license.eligible_media_ids.map(id => r2.get(id)?.display_name)
          )
        ],
        v3_binders: [
          ...new Set(
            license.eligible_media_ids.map(id => r3.get(id)?.display_name)
          )
        ],
        decision,
        position: i + 1
      });
    }
    return {
      group_id: group.group_id,
      kind: group.kind,
      search_key: group.key,
      licenses: licenses.length,
      known_media: known.length,
      eligible_media: media.length,
      v2_series: before.size,
      v3_series: after.size,
      decision,
      reason,
      explicit_v3_review_ids: newGroups,
      production_approved: false
    };
  });
  const licenseRows = index.licenses.map(l => ({
    source_license: l.name,
    normalized_name: normalizedLicenseName(l.name),
    compact_name: compactLicenseName(l.name),
    season_stem: seasonNameStem(l.name),
    cards: l.card_ids.length,
    manual: l.manual_card_ids.length,
    unknown: l.unknown_card_ids.length,
    protected: l.protected_card_ids.length,
    secondary_links: l.secondary_card_ids.length,
    known_media_ids: l.known_media_ids,
    eligible_media_ids: l.eligible_media_ids,
    candidate_groups: [...(byLicense.get(l.name) ?? [])],
    audit_status: byLicense.has(l.name)
      ? "INDEXED_WITH_CANDIDATES"
      : "INDEXED_NO_CANDIDATE",
    production_changed: false
  }));
  const aliasRows = index.licenses.flatMap(l =>
    l.known_media_ids.flatMap(id => {
      const m = mediaCache.entries[id]?.media;
      if (!m) return [];
      return [
        m.title.english,
        m.title.romaji,
        m.title.native,
        ...(m.synonyms ?? [])
      ]
        .filter(Boolean)
        .map(alias => ({
          source_license: l.name,
          media_id: id,
          alias,
          alias_type:
            alias === m.title.english
              ? "ENGLISH"
              : alias === m.title.romaji
                ? "ROMAJI"
                : alias === m.title.native
                  ? "NATIVE"
                  : "API_SYNONYM",
          verified_media_url: m.siteUrl,
          eligible_for_projection: l.eligible_media_ids.includes(id),
          note: "Media title equivalence is not proof of card provenance or cross-media series membership"
        }));
    })
  );
  const mediaRows = [...r3.values()].map(r => ({
    media_id: r.media_id,
    exact_english: mediaCache.entries[r.media_id]?.media?.title.english,
    exact_romaji: mediaCache.entries[r.media_id]?.media?.title.romaji,
    v2_binder_id: r2.get(r.media_id)?.binder_id,
    v3_binder_id: r.binder_id,
    v2_display: r2.get(r.media_id)?.display_name,
    v3_display: r.display_name,
    v2_decision: r2.get(r.media_id)?.decision,
    v3_decision: r.decision,
    review_id: r.review_id ?? "",
    reason: r.reason
  }));
  const conflicts = mediaRows.filter(
    r =>
      r.v2_binder_id !== r.v3_binder_id ||
      r.v2_display !== r.v3_display ||
      r.v2_decision !== r.v3_decision
  );
  const a2 = new Map(
      mappingV2.assignments.map(a => [
        JSON.stringify([a.card_id, a.source_license]),
        a
      ])
    ),
    a3 = new Map(
      mappingV3.assignments.map(a => [
        JSON.stringify([a.card_id, a.source_license]),
        a
      ])
    );
  const cardRows = [],
    changed = [];
  for (const c of snapshot.cards)
    for (const link of c.links) {
      const key = JSON.stringify([c.id, link.franchise]),
        old = a2.get(key),
        next = a3.get(key),
        sourceKey =
          "source:" +
          sha256(c.categorie + String.fromCharCode(31) + link.franchise);
      const before = old ? "series:" + old.binder_id : sourceKey,
        after = next ? "series:" + next.binder_id : sourceKey;
      const row = {
        card_id: c.id,
        source: c.source,
        character_id: c.source_id,
        source_license: link.franchise,
        source_position: link.position,
        media_id: next?.media_id ?? old?.media_id ?? "",
        v2_key: before,
        v3_key: after,
        v2_display: old ? r2.get(old.media_id).display_name : link.franchise,
        v3_display: next ? r3.get(next.media_id).display_name : link.franchise,
        projected_v3: Boolean(next),
        review_id: next ? (r3.get(next.media_id)?.review_id ?? "") : "",
        reason: next
          ? r3.get(next.media_id).reason
          : "Exact source presentation retained; no eligible assignment."
      };
      cardRows.push(row);
      if (before !== after || row.v2_display !== row.v3_display)
        changed.push(row);
    }
  const proposedGroups = V3_REVIEW.groups.map(g => {
    const selected = new Set(
        mappingV3.media_rules
          .filter(r => r.review_id === g.review_id)
          .map(r => r.media_id)
      ),
      as = mappingV3.assignments.filter(a => selected.has(a.media_id));
    return {
      review_id: g.review_id,
      target: g.name,
      root_media_id: g.root_media_id,
      selected_media_ids: g.media_ids,
      all_projected_media_ids: [...selected],
      cards: new Set(as.map(a => a.card_id)).size,
      source_licenses: [...new Set(as.map(a => a.source_license))],
      binder_id: as[0]?.binder_id ?? "",
      reason: g.reason,
      evidence_urls: g.evidence_urls,
      verified_path_count: g.verified_paths.length,
      production_approved: false
    };
  });
  const protectedIds = new Set(
    matches
      .filter(r => r.eligible !== true && r.eligible !== "true")
      .map(r => r.card_id)
  );
  for (const row of cardRows.filter(r => protectedIds.has(r.card_id)))
    if (
      row.projected_v3 ||
      row.v3_display !== row.source_license ||
      row.v2_key !== row.v3_key
    )
      throw new Error("Protected displayed binder changed");
  const sourceIds = new Set(
    snapshot.cards.flatMap(c => c.links.map(l => l.franchise))
  );
  if (
    licenseRows.length !== sourceIds.size ||
    licenseRows.some(r => !sourceIds.has(r.source_license))
  )
    throw new Error("Incomplete exact license inventory");
  const summary = {
    snapshot_at: snapshot.captured_at,
    source_licenses: licenseRows.length,
    source_cards: snapshot.cards.length,
    source_links: cardRows.length,
    v2_binders: mappingV2.summary.proposed_binders_after,
    v3_binders: mappingV3.summary.proposed_binders_after,
    net_additional_reduction:
      mappingV2.summary.proposed_binders_after -
      mappingV3.summary.proposed_binders_after,
    index_metrics: index.metrics,
    name_groups: summaries.length,
    group_membership_rows: groupMemberships.length,
    licenses_with_candidates: licenseRows.filter(r => r.candidate_groups.length)
      .length,
    licenses_without_candidates: licenseRows.filter(
      r => !r.candidate_groups.length
    ).length,
    new_reviewed_series_groups: proposedGroups.length,
    changed_primary_media_rules: conflicts.length,
    changed_card_links: changed.length,
    changed_display_names: changed.filter(r => r.v2_display !== r.v3_display)
      .length,
    protected_card_ids: protectedIds.size,
    manual_cards: snapshot.cards.filter(c => c.source === "manual").length,
    production_changed: false,
    favorites_reset: false,
    decision_counts: Object.fromEntries(
      [...Map.groupBy(summaries, r => r.decision)].map(([k, v]) => [
        k,
        v.length
      ])
    )
  };
  return {
    summary,
    index,
    files: {
      "all_licenses_audited.csv": licenseRows,
      "similar_name_groups.csv": summaries,
      "name_group_members.csv": groupMemberships,
      "verified_english_romaji_aliases.csv": aliasRows,
      "additional_merges_proposed.csv": proposedGroups,
      "conflicts_with_mapping_v2.csv": conflicts,
      "comparison_v2_v3_all_media.csv": mediaRows,
      "comparison_v2_v3_changed_cards.csv": changed,
      "catalogue_source_links.csv": cardRows,
      "false_positives_and_exclusions.csv": summaries.filter(r =>
        [
          "EXCLUDED_GRAMMATICAL_PREFIX",
          "KEEP_DISTINCT_OR_UNCONFIRMED",
          "MIXED_GROUP_WITH_EXCLUDED_BRANCHES"
        ].includes(r.decision)
      ),
      "protected_card_display_links.csv": cardRows.filter(r =>
        protectedIds.has(r.card_id)
      )
    }
  };
}
async function main() {
  const { values } = parseArgs({
    options: Object.fromEntries(
      [
        "snapshot",
        "matches",
        "media-cache",
        "mapping-v2",
        "mapping-v3",
        "output"
      ].map(k => [k, { type: "string" }])
    )
  });
  for (const k of [
    "snapshot",
    "matches",
    "media-cache",
    "mapping-v2",
    "mapping-v3",
    "output"
  ])
    if (!values[k]) throw new Error(`Missing --${k}`);
  const audit = auditLicenseNames({
    snapshot: readJSON(values.snapshot),
    matches: parse(readFileSync(values.matches, "utf8"), {
      columns: true,
      bom: true,
      delimiter: ";"
    }),
    mediaCache: readJSON(values["media-cache"]),
    mappingV2: readJSON(values["mapping-v2"]),
    mappingV3: readJSON(values["mapping-v3"])
  });
  const out = resolve(values.output);
  mkdirSync(out, { recursive: true });
  for (const [file, rows] of Object.entries(audit.files))
    writeFileSync(join(out, file), csv(rows));
  writeFileSync(
    join(out, "name_index_summary.json"),
    JSON.stringify(audit.summary, null, 2) + "\n"
  );
  writeFileSync(
    join(out, "name_index_inputs_sha256.json"),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(values)
          .filter(([k]) => k !== "output")
          .map(([k, p]) => [k, sha256(readFileSync(p))])
      ),
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
  main().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
