import assert from "node:assert/strict";
import { stableSeriesId } from "./anime-series-provenance.mjs";

// Pure preparation only. No database, filesystem, approval or activation action.
export function applyQualityAmendments(mapping, amendments, protectedCardIds) {
  assert.equal(mapping.schema_version, 3, "Expected the existing V3 mapping");
  for (const value of [mapping, amendments]) {
    assert.equal(
      value.editorial_approved,
      false,
      "Review must remain unapproved"
    );
    assert.equal(
      value.production_approved,
      false,
      "Production is not authorized"
    );
  }
  assert.equal(mapping.default_enabled, false, "Projection must stay disabled");
  assert(
    protectedCardIds instanceof Set,
    "Explicit protected-card inventory required"
  );
  assert(
    mapping.assignments.every(a => !protectedCardIds.has(a.card_id)),
    "A protected card cannot be projected"
  );
  const candidate = structuredClone(mapping);
  const rules = new Map(
    candidate.media_rules.map(rule => [rule.media_id, rule])
  );
  const originalRules = new Map(
    mapping.media_rules.map(rule => [rule.media_id, rule])
  );
  const usedBinders = new Set(
    candidate.media_rules.map(rule => rule.binder_id)
  );
  const changedMedia = new Set();
  const log = [];

  for (const change of amendments.separations) {
    const nextBinder = stableSeriesId(change.target_root_media_id);
    assert(
      !usedBinders.has(nextBinder),
      "A separation must create an independent identity"
    );
    const oldBinders = new Set();
    for (const id of change.media_ids) {
      assert(!changedMedia.has(id), "Overlapping quality separations");
      const rule = rules.get(id);
      assert(rule, `Missing reviewed media ${id}`);
      assert.equal(rule.decision, "A");
      assert.equal(rule.editorial_approved, false);
      assert.equal(rule.production_approved, false);
      assert.equal(
        rule.series_media_id,
        change.expected_root_media_id,
        "V3 identity drift"
      );
      assert.equal(
        rule.display_name,
        change.expected_display_name,
        "V3 title drift"
      );
      oldBinders.add(rule.binder_id);
      Object.assign(rule, {
        series_media_id: change.target_root_media_id,
        binder_id: nextBinder,
        display_name: change.display_name,
        reason: change.reason,
        quality_review_id: change.id
      });
      changedMedia.add(id);
    }
    const affected = candidate.assignments.filter(a =>
      change.media_ids.includes(a.media_id)
    );
    assert(affected.length > 0, "A catalogue separation needs verified cards");
    for (const binder of oldBinders)
      assert(
        candidate.assignments.some(
          a => a.binder_id === binder && !change.media_ids.includes(a.media_id)
        ),
        "Retained identity must keep represented cards"
      );
    usedBinders.add(nextBinder);
    log.push({
      id: change.id,
      action: "SEPARATE",
      media_ids: change.media_ids,
      old_binder_ids: [...oldBinders],
      new_binder_id: nextBinder,
      cards: affected.length
    });
  }

  for (const change of amendments.display_renames) {
    const anchor = rules.get(change.anchor_media_id);
    assert(anchor, "Missing rename anchor");
    const binder = anchor.binder_id;
    const members = candidate.media_rules.filter(
      rule => rule.binder_id === binder
    );
    assert(
      members.every(rule => rule.display_name === change.expected_display_name),
      "V3 binder title drift"
    );
    for (const rule of members) {
      rule.display_name = change.display_name;
      rule.quality_review_id = change.id;
    }
    log.push({
      id: change.id,
      action: "RENAME_DISPLAY",
      binder_id: binder,
      display_name: change.display_name
    });
  }

  for (const assignment of candidate.assignments) {
    const rule = rules.get(assignment.media_id);
    if (assignment.binder_id === rule.binder_id) continue;
    const card = assignment.verified_snapshot;
    assert.equal(
      card.source,
      "anilist",
      "Manual/unknown origins are immutable"
    );
    assert.equal(card.categorie, "ANIME/MANGA");
    assert.equal(card.id, assignment.card_id);
    assert.equal(
      card.franchise,
      assignment.source_license,
      "Only the exact primary source link can change presentation"
    );
    assert.equal(String(card.source_id), String(assignment.character_id));
    assert.match(assignment.import_evidence_sha256, /^[a-f0-9]{64}$/);
    assert(changedMedia.has(assignment.media_id), "Unexpected binder change");
    assignment.binder_id = rule.binder_id;
  }
  assert.equal(candidate.assignments.length, mapping.assignments.length);
  assert(
    candidate.media_rules.every(rule => {
      const original = originalRules.get(rule.media_id);
      return (
        rule.editorial_approved === original.editorial_approved &&
        rule.production_approved === original.production_approved
      );
    }),
    "No approval changes are allowed"
  );
  candidate.base_audit_summary = structuredClone(mapping.summary);
  candidate.summary.proposed_binders_after += amendments.separations.length;
  candidate.summary.proposed_series_groups = new Set(
    candidate.assignments.map(a => a.binder_id)
  ).size;
  candidate.summary.proposed_mapping_rows = new Set(
    candidate.assignments.map(a =>
      JSON.stringify([a.binder_id, a.media_id, a.source_license])
    )
  ).size;
  candidate.quality_review = {
    id: amendments.review,
    production_changed: false,
    activation_authorized: false,
    note: "Final quality candidate. Original V3 diagnostics remain in base_audit_summary. Current presentation totals are independently verified in the private quality report.",
    amendments: log
  };
  return candidate;
}
