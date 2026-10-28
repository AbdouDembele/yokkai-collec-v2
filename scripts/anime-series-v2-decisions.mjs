import { readFileSync } from "node:fs";
import { buildSeriesDecisions } from "./anime-series-decisions.mjs";
import { stableSeriesId } from "./anime-series-provenance.mjs";

export const V2_REVIEW = JSON.parse(
  readFileSync(
    new URL("../data/editorial/anime-series-v2-review.json", import.meta.url),
    "utf8"
  )
);
export const V2_GROUPS = JSON.parse(
  readFileSync(
    new URL("../data/editorial/anime-series-v2-groups.json", import.meta.url),
    "utf8"
  )
);
export const V2_TV_REVIEW = JSON.parse(
  readFileSync(
    new URL(
      "../data/editorial/anime-series-v2-tv-review.json",
      import.meta.url
    ),
    "utf8"
  )
);
const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join(":");

export function validateReview(review) {
  if (review.pairs.length !== 1095)
    throw new Error("Expected all 1095 V1 B pairs");
  const keys = new Set();
  for (const [index, row] of review.pairs.entries()) {
    const key = pairKey(row.source_media_id, row.target_media_id);
    if (
      row.review_index !== index + 1 ||
      keys.has(key) ||
      !["A", "B", "C"].includes(row.status) ||
      !row.reason ||
      row.evidence_urls.length < 2 ||
      row.editorial_approved ||
      row.production_approved
    )
      throw new Error(`Invalid individual review at ${index + 1}`);
    keys.add(key);
  }
}

// Explicit reviewed media lists replace V1's blanket short-format ambiguity.
// C/B decisions constrain the whole component, including indirect paths.
// No unknown media inherits the editorial lists by a name or franchise prefix.
export function buildV2SeriesDecisions(
  mediaById,
  representedIds,
  previousRules = [],
  review = V2_REVIEW,
  groups = V2_GROUPS.groups
) {
  validateReview(review);
  const base = buildSeriesDecisions(mediaById, representedIds);
  const ids = new Set(representedIds),
    parent = new Map([...ids].map(id => [id, id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  };
  const allReviewed = [...review.pairs, ...V2_TV_REVIEW.pairs];
  const reviewed = new Map(
    allReviewed.map(row => [
      pairKey(row.source_media_id, row.target_media_id),
      row
    ])
  );
  const boundaries = allReviewed
    .filter(row => row.status !== "A")
    .map(row => [row.source_media_id, row.target_media_id, row.review_index]);
  boundaries.push([20605, 100240, "Tokyo owner boundary"]);
  const explicitGroups = groups.filter(
    group => group.review_source === "explicit-editorial-review"
  );
  for (let i = 0; i < explicitGroups.length; i++)
    for (let j = i + 1; j < explicitGroups.length; j++) {
      const left = explicitGroups[i],
        right = explicitGroups[j];
      if (left.media_ids.some(id => right.media_ids.includes(id)))
        throw new Error(
          `Overlapping explicit series identities: ${left.name}/${right.name}`
        );
      const a = left.media_ids.find(id => ids.has(id)),
        b = right.media_ids.find(id => ids.has(id));
      if (a && b) boundaries.push([a, b, `${left.name}/${right.name}`]);
    }
  const unite = (a, b, context) => {
    if (!ids.has(a) || !ids.has(b)) return;
    const left = find(a),
      right = find(b);
    if (left === right) return;
    for (const [x, y, index] of boundaries) {
      if (!ids.has(x) || !ids.has(y)) continue;
      const xr = find(x),
        yr = find(y);
      if ((xr === left && yr === right) || (xr === right && yr === left))
        throw new Error(
          `Editorial boundary ${index} violated by ${context}: ${a}/${b}`
        );
    }
    parent.set(right, left);
  };
  const pairs = base.pairs.map(pair => {
    const row = reviewed.get(
      pairKey(pair.source_media_id, pair.target_media_id)
    );
    return row
      ? {
          ...pair,
          status: row.status,
          reason: row.reason,
          review_index: row.review_index
        }
      : pair;
  });
  for (const pair of pairs)
    if (pair.status === "A")
      unite(
        pair.source_media_id,
        pair.target_media_id,
        `pair ${pair.review_index ?? "V1"}`
      );
  // The ledger is still authoritative when a cache presents the reciprocal edge
  // first, and explicitly selected groups can cover a missing intermediate season.
  for (const row of allReviewed)
    if (row.status === "A")
      unite(
        row.source_media_id,
        row.target_media_id,
        `review ${row.review_index}`
      );
  for (const group of groups) {
    const present = group.media_ids.filter(id => ids.has(id));
    for (const id of present.slice(1)) unite(present[0], id, group.name);
  }
  const components = new Map();
  for (const id of ids) {
    const list = components.get(find(id)) ?? [];
    list.push(id);
    components.set(find(id), list);
  }
  const oldByMedia = new Map(
    previousRules
      .filter(row => row.decision === "A")
      .map(row => [row.media_id, row])
  );
  const rules = [];
  for (const component of components.values()) {
    const explicit = groups
      .filter(
        group =>
          group.review_source === "explicit-editorial-review" &&
          group.media_ids.some(id => component.includes(id))
      )
      .at(-1);
    const named =
      explicit ??
      groups.find(group => group.media_ids.some(id => component.includes(id)));
    const chronological = component.toSorted(
      (a, b) =>
        (mediaById.get(a)?.startDate?.year ?? 9999) -
          (mediaById.get(b)?.startDate?.year ?? 9999) || a - b
    );
    const root =
      explicit?.media_ids.find(id => component.includes(id)) ??
      chronological[0];
    const old =
      oldByMedia.get(root) ??
      component
        .map(id => oldByMedia.get(id))
        .find(row => row && component.includes(row.series_media_id));
    // Reuse an existing V1 identity when extending its series, including when an
    // earlier season becomes connected. Absorbed IDs remain in the comparison.
    const binderId = old?.binder_id ?? stableSeriesId(root);
    const name =
      named?.name ??
      base.rules.find(row => row.media_id === root)?.display_name ??
      mediaById.get(root)?.title.english ??
      mediaById.get(root)?.title.romaji;
    const unresolved = review.pairs.filter(
      row =>
        row.status === "B" &&
        component.some(id =>
          [row.source_media_id, row.target_media_id].includes(id)
        )
    );
    for (const id of component)
      rules.push({
        media_id: id,
        series_media_id: old?.series_media_id ?? root,
        binder_id: binderId,
        display_name: name,
        decision:
          component.length > 1 || explicit
            ? "A"
            : unresolved.length
              ? "B"
              : "C",
        editorial_approved: false,
        production_approved: false,
        reason:
          named?.reason ??
          (component.length > 1
            ? "Individual V2 relationship review: direct same-series continuation/extras; independent branches excluded."
            : (unresolved[0]?.reason ??
              "Independent media: no reviewed same-series continuation in this catalogue.")),
        review_version: 2
      });
  }
  const byMedia = new Map(rules.map(rule => [rule.media_id, rule]));
  for (const pair of pairs) {
    if (
      pair.status !== "A" &&
      byMedia.has(pair.source_media_id) &&
      byMedia.has(pair.target_media_id) &&
      byMedia.get(pair.source_media_id).binder_id ===
        byMedia.get(pair.target_media_id).binder_id
    ) {
      pair.status = "A";
      pair.reason = `Explicit V2 media-group review: ${byMedia.get(pair.source_media_id).display_name}. ${byMedia.get(pair.source_media_id).reason}`;
    }
  }
  // A reviewed pair may already have been preserved in a single physical source.
  // Still expose its explicit decision; this does not mean a new source mutation.
  return { rules, pairs };
}
