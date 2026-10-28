import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyQualityAmendments } from "../scripts/anime-series-quality-decisions.mjs";
import { stableSeriesId } from "../scripts/anime-series-provenance.mjs";

const amendments = JSON.parse(
  readFileSync(
    new URL(
      "../data/editorial/anime-series-v3-quality-amendments.json",
      import.meta.url
    ),
    "utf8"
  )
);
function fixture() {
  const rows = [
    [21, 466, "One Piece"],
    [197179, 466, "One Piece"],
    [99230, 99230, "RILAKKUMA"],
    [125440, 99230, "RILAKKUMA"],
    [183231, 99230, "RILAKKUMA"],
    [98289, 98289, "Beyblade Burst Evolution"],
    [101115, 98289, "Beyblade Burst Evolution"],
    [185, 185, "Initial D 1st Stage"],
    [154966, 154966, "Fate/strange Fake -Whispers of Dawn-"],
    [90, 90, "Mobile Suit Gundam Wing: Endless Waltz"],
    [91, 90, "Mobile Suit Gundam Wing: Endless Waltz"],
    [1491, 1491, "Galaxy Express 999"],
    [1301, 1491, "Galaxy Express 999"],
    [20605, 20605, "Tokyo Ghoul"],
    [100240, 100240, "Tokyo Ghoul:re"]
  ];
  return {
    schema_version: 3,
    editorial_approved: false,
    production_approved: false,
    default_enabled: false,
    summary: { proposed_binders_after: new Set(rows.map(r => r[1])).size },
    media_rules: rows.map(([media_id, series_media_id, display_name]) => ({
      media_id,
      series_media_id,
      display_name,
      binder_id: stableSeriesId(series_media_id),
      decision: "A",
      editorial_approved: false,
      production_approved: false
    })),
    assignments: rows.map(([media_id, root, source_license], i) => ({
      card_id: `synthetic-${i}`,
      media_id,
      binder_id: stableSeriesId(root),
      source_license,
      character_id: i + 1,
      import_evidence_sha256: "a".repeat(64),
      verified_snapshot: {
        id: `synthetic-${i}`,
        source: "anilist",
        source_id: String(i + 1),
        categorie: "ANIME/MANGA",
        franchise: source_license,
        nom: `Synthetic ${i}`
      }
    }))
  };
}

test("quality review separates the parody and independent Rilakkuma adaptation while preserving base evidence", () => {
  const base = fixture(),
    original = structuredClone(base);
  const result = applyQualityAmendments(
    base,
    amendments,
    new Set(["protected-source-only"])
  );
  assert.deepEqual(base, original);
  const rule = id => result.media_rules.find(r => r.media_id === id);
  assert.notEqual(rule(21).binder_id, rule(197179).binder_id);
  assert.equal(rule(197179).series_media_id, 188668);
  assert.equal(rule(99230).binder_id, rule(125440).binder_id);
  assert.notEqual(rule(99230).binder_id, rule(183231).binder_id);
  assert.equal(
    rule(99230).binder_id,
    original.media_rules.find(r => r.media_id === 99230).binder_id
  );
  assert.equal(
    result.summary.proposed_binders_after,
    base.summary.proposed_binders_after + 2
  );
  for (let i = 0; i < result.assignments.length; i++) {
    const { binder_id: after, ...card } = result.assignments[i];
    const { binder_id: before, ...oldCard } = original.assignments[i];
    assert.deepEqual(card, oldCard);
    if (![197179, 183231].includes(card.media_id)) assert.equal(after, before);
  }
});

test("display corrections retain stable keys and the owner's Galaxy/Tokyo boundaries", () => {
  const base = fixture(),
    result = applyQualityAmendments(base, amendments, new Set());
  const rule = id => result.media_rules.find(r => r.media_id === id);
  assert.equal(rule(98289).display_name, "Beyblade Burst");
  assert.equal(rule(101115).binder_id, stableSeriesId(98289));
  assert.equal(rule(90).display_name, "Mobile Suit Gundam Wing");
  assert.equal(rule(91).binder_id, stableSeriesId(90));
  assert.equal(rule(1491).binder_id, rule(1301).binder_id);
  assert.notEqual(rule(20605).binder_id, rule(100240).binder_id);
  assert.equal(result.default_enabled, false);
  assert.equal(result.editorial_approved, false);
  assert.equal(result.production_approved, false);
  assert(
    result.media_rules.every(
      r => !r.production_approved && !r.editorial_approved
    )
  );
});

test("quality preparation refuses protected cards, manual origins and edited primary links", () => {
  const base = fixture();
  assert.throws(
    () =>
      applyQualityAmendments(
        base,
        amendments,
        new Set([base.assignments[1].card_id])
      ),
    /protected/i
  );
  for (const source of ["manual", "unknown"]) {
    const edited = fixture();
    edited.assignments[1].verified_snapshot.source = source;
    assert.throws(
      () => applyQualityAmendments(edited, amendments, new Set()),
      /origins/i
    );
  }
  const edited = fixture();
  edited.assignments[1].source_license = "Edited source";
  assert.throws(
    () => applyQualityAmendments(edited, amendments, new Set()),
    /primary/i
  );
});

test("quality preparation refuses approval, activation, identity drift and repeated application", () => {
  for (const field of [
    "editorial_approved",
    "production_approved",
    "default_enabled"
  ]) {
    const base = fixture();
    base[field] = true;
    assert.throws(() => applyQualityAmendments(base, amendments, new Set()));
  }
  const drift = fixture();
  drift.media_rules.find(r => r.media_id === 197179).series_media_id = 21;
  assert.throws(
    () => applyQualityAmendments(drift, amendments, new Set()),
    /drift/i
  );
  const result = applyQualityAmendments(fixture(), amendments, new Set());
  assert.throws(() => applyQualityAmendments(result, amendments, new Set()));
  assert.throws(
    () => applyQualityAmendments(fixture(), amendments),
    /inventory/i
  );
});
