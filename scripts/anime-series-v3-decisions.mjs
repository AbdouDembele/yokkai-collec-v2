import { readFileSync } from "node:fs";
import {
  buildV2SeriesDecisions,
  V2_GROUPS,
  V2_REVIEW,
  V2_TV_REVIEW
} from "./anime-series-v2-decisions.mjs";
import { stableSeriesId } from "./anime-series-provenance.mjs";

export const V3_REVIEW = JSON.parse(
  readFileSync(
    new URL("../data/editorial/anime-series-v3-groups.json", import.meta.url),
    "utf8"
  )
);
const key = (a, b) => [a, b].sort((x, y) => x - y).join(":");

export function buildV3SeriesDecisions(
  mediaById,
  representedIds,
  previousRules,
  review = V3_REVIEW
) {
  if (!previousRules?.length)
    throw new Error("V3 requires the immutable V2 reference");
  const baseline = buildV2SeriesDecisions(
    mediaById,
    representedIds,
    previousRules
  );
  const ids = new Set(representedIds),
    parent = new Map([...ids].map(id => [id, id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  };
  const overrides = new Set(
    review.override_v2_separations.map(r =>
      key(r.source_media_id, r.target_media_id)
    )
  );
  const boundaries = [...V2_REVIEW.pairs, ...V2_TV_REVIEW.pairs]
    .filter(
      p =>
        p.status !== "A" &&
        !overrides.has(key(p.source_media_id, p.target_media_id))
    )
    .map(p => [p.source_media_id, p.target_media_id]);
  boundaries.push(...review.additional_boundaries);
  const keepGroupsSeparate = groups => {
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i].media_ids.some(id => groups[j].media_ids.includes(id)))
          throw new Error("Overlapping explicit V3 series identities");
        const a = groups[i].media_ids.find(id => ids.has(id)),
          b = groups[j].media_ids.find(id => ids.has(id));
        if (a && b) boundaries.push([a, b]);
      }
  };
  keepGroupsSeparate(
    V2_GROUPS.groups.filter(
      g => g.review_source === "explicit-editorial-review"
    )
  );
  keepGroupsSeparate(review.groups);
  for (const a of [20605, 20850, 21132, 21326])
    for (const b of [100240, 102351]) boundaries.push([a, b]);
  const yugioh = [550, 481, 482, 3972, 10015, 20552, 98231, 114072, 142842];
  for (let i = 0; i < yugioh.length; i++)
    for (let j = i + 1; j < yugioh.length; j++)
      boundaries.push([yugioh[i], yugioh[j]]);
  const unite = (a, b, reason) => {
    if (!ids.has(a) || !ids.has(b)) return;
    const left = find(a),
      right = find(b);
    if (left === right) return;
    for (const [x, y] of boundaries) {
      if (!ids.has(x) || !ids.has(y)) continue;
      const xr = find(x),
        yr = find(y);
      if ((xr === left && yr === right) || (yr === left && xr === right))
        throw new Error(
          `V3 independent-series boundary ${x}/${y} violated by ${reason}`
        );
    }
    parent.set(right, left);
  };
  const priorComponents = new Map();
  for (const rule of baseline.rules) {
    const first = priorComponents.get(rule.binder_id);
    if (first) unite(first, rule.media_id, "V2 baseline");
    else priorComponents.set(rule.binder_id, rule.media_id);
  }
  for (const group of review.groups) {
    if (
      group.production_approved !== false ||
      group.editorial_approved !== false ||
      !group.reason ||
      !group.evidence_urls.length
    )
      throw new Error("Unapproved explicit V3 evidence required");
    const present = group.media_ids.filter(id => ids.has(id));
    for (const id of present.slice(1)) unite(present[0], id, group.review_id);
  }
  const components = new Map();
  for (const id of ids) {
    const set = components.get(find(id)) ?? [];
    set.push(id);
    components.set(find(id), set);
  }
  const baselineById = new Map(baseline.rules.map(r => [r.media_id, r])),
    previousById = new Map(previousRules.map(r => [r.media_id, r]));
  const rules = [];
  for (const component of components.values()) {
    const group = review.groups.find(g =>
      g.media_ids.some(id => component.includes(id))
    );
    if (!group) {
      rules.push(
        ...component.map(id => ({ ...baselineById.get(id), review_version: 3 }))
      );
      continue;
    }
    const old =
      previousById.get(group.root_media_id)?.decision === "A"
        ? previousById.get(group.root_media_id)
        : component
            .map(id => previousById.get(id))
            .filter(r => r?.decision === "A")
            .sort((a, b) => a.series_media_id - b.series_media_id)[0];
    const binderId = old?.binder_id ?? stableSeriesId(group.root_media_id);
    for (const id of component)
      rules.push({
        ...baselineById.get(id),
        series_media_id: group.root_media_id,
        binder_id: binderId,
        display_name: group.name,
        decision: "A",
        editorial_approved: false,
        production_approved: false,
        reason: group.reason,
        review_version: 3,
        review_id: group.review_id
      });
  }
  const byId = new Map(rules.map(r => [r.media_id, r]));
  const pairs = baseline.pairs.map(p =>
    byId.get(p.source_media_id)?.binder_id ===
    byId.get(p.target_media_id)?.binder_id
      ? { ...p, status: "A", reason: byId.get(p.source_media_id).reason }
      : p
  );
  for (const group of review.groups) {
    const present = group.media_ids.filter(id => ids.has(id));
    for (const id of present.slice(1))
      if (
        !pairs.some(
          p => key(p.source_media_id, p.target_media_id) === key(present[0], id)
        )
      )
        pairs.push({
          source_media_id: present[0],
          target_media_id: id,
          relation: "VERIFIED_SERIES_REVIEW",
          status: "A",
          reason: group.reason,
          review_id: group.review_id,
          verified_paths: group.verified_paths,
          evidence_urls: group.evidence_urls
        });
  }
  return { rules, pairs };
}
