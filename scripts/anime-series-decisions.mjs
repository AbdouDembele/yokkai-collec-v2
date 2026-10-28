import {
  candidateSeasonStem,
  identityText,
  stableSeriesId
} from "./anime-series-provenance.mjs";

// Explicit product examples override every graph edge and lexical candidate.
export const TOKYO_SERIES = new Map([
  [
    20605,
    {
      root: 20605,
      title: "Tokyo Ghoul",
      status: "A",
      reason: "Explicit owner rule: original series."
    }
  ],
  [
    20850,
    {
      root: 20605,
      title: "Tokyo Ghoul",
      status: "A",
      reason: "Explicit owner rule: Tokyo Ghoul √A is the direct second season."
    }
  ],
  [
    100240,
    {
      root: 100240,
      title: "Tokyo Ghoul:re",
      status: "A",
      reason: "Explicit owner rule: :re is a distinct major series."
    }
  ],
  [
    102351,
    {
      root: 100240,
      title: "Tokyo Ghoul:re",
      status: "A",
      reason: "Explicit owner rule: :re 2nd Season belongs only to :re."
    }
  ]
]);

const same = (a, b) =>
  identityText(a).toLowerCase() === identityText(b).toLowerCase();
const titles = media =>
  [media?.title?.english, media?.title?.romaji].filter(Boolean);
const shortFormats = new Set([
  "MOVIE",
  "OVA",
  "ONA",
  "SPECIAL",
  "MUSIC",
  "TV_SHORT"
]);
const eligibleRelations = new Set([
  "PREQUEL",
  "SEQUEL",
  "SIDE_STORY",
  "PARENT",
  "SPIN_OFF",
  "ALTERNATIVE",
  "OTHER",
  "ADAPTATION",
  "SUMMARY",
  "COMPILATION"
]);

export function classifyMediaPair(a, b, relation) {
  if (!a || !b)
    return {
      status: "D",
      reason: "Media identity is missing; no transformation."
    };
  if (a.id === b.id)
    return {
      status: "A",
      reason: "Same verified AniList media identity; title variants only."
    };
  const explicitA = TOKYO_SERIES.get(a.id),
    explicitB = TOKYO_SERIES.get(b.id);
  if (explicitA && explicitB)
    return explicitA.root === explicitB.root
      ? { status: "A", reason: "Explicit Tokyo Ghoul series policy." }
      : {
          status: "C",
          reason: "Explicit owner separation: Tokyo Ghoul and Tokyo Ghoul:re."
        };
  if (!eligibleRelations.has(relation))
    return {
      status: "C",
      reason:
        "No approved direct season identity; relation does not establish a shared binder."
    };
  if (["SPIN_OFF", "ALTERNATIVE", "ADAPTATION"].includes(relation))
    return {
      status: "C",
      reason:
        "Independent branch, alternative series or medium adaptation: retain separately unless explicitly reviewed."
    };
  if (
    ["SIDE_STORY", "PARENT", "SUMMARY", "COMPILATION", "OTHER"].includes(
      relation
    ) ||
    shortFormats.has(a.format) ||
    shortFormats.has(b.format)
  )
    return {
      status: "B",
      reason:
        "Film, special, adaptation boundary or side story needs individual editorial review."
    };
  // Text only discovers a candidate; an actual direct PREQUEL/SEQUEL edge and
  // matching exact series stem must both be present. Never use graph closure.
  const direct = relation === "PREQUEL" || relation === "SEQUEL";
  const seasonTitle = titles(a).some(x =>
    titles(b).some(y => {
      const xs = candidateSeasonStem(x),
        ys = candidateSeasonStem(y);
      return (xs !== identityText(x) || ys !== identityText(y)) && same(xs, ys);
    })
  );
  if (
    direct &&
    seasonTitle &&
    a.type === b.type &&
    a.format === "TV" &&
    b.format === "TV"
  )
    return {
      status: "A",
      reason:
        "Direct verified season relation, explicit season/part designation and same exact series stem."
    };
  if (
    direct &&
    titles(a).some(x =>
      titles(b).some(y => same(candidateSeasonStem(x), candidateSeasonStem(y)))
    )
  )
    return {
      status: "B",
      reason:
        "Related sequel with a close title but insufficient direct season identity."
    };
  return {
    status: "C",
    reason:
      "Distinct major series identity: preserve separate binders; PREQUEL/SEQUEL alone is insufficient."
  };
}

export function buildSeriesDecisions(mediaById, representedIds) {
  const ids = new Set(representedIds),
    parent = new Map([...ids].map(id => [id, id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  };
  const pairs = [],
    seen = new Set();
  for (const id of ids) {
    const media = mediaById.get(id);
    if (!media) continue;
    for (const edge of media.relations?.edges ?? []) {
      const target = edge.node.id;
      if (!ids.has(target)) continue;
      const key = [id, target].sort((a, b) => a - b).join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      const decision = classifyMediaPair(
        media,
        mediaById.get(target),
        edge.relationType
      );
      pairs.push({
        source_media_id: id,
        target_media_id: target,
        relation: edge.relationType,
        ...decision
      });
      if (decision.status === "A") {
        const left = find(id),
          right = find(target);
        if (left !== right)
          parent.set(Math.max(left, right), Math.min(left, right));
      }
    }
  }
  // Do not rely on whether AniList happens to include all mandatory example edges.
  for (const [id, rule] of TOKYO_SERIES)
    if (ids.has(id) && ids.has(rule.root))
      parent.set(find(id), find(rule.root));
  const components = new Map();
  for (const id of ids) {
    const root = find(id),
      list = components.get(root) ?? [];
    list.push(id);
    components.set(root, list);
  }
  const rules = [];
  for (const component of components.values()) {
    const tokyo = component.map(id => TOKYO_SERIES.get(id)).find(Boolean);
    const ordered = component.toSorted((a, b) => {
      const am = mediaById.get(a),
        bm = mediaById.get(b);
      return (
        (am?.startDate?.year ?? 9999) - (bm?.startDate?.year ?? 9999) || a - b
      );
    });
    const root = tokyo?.root ?? ordered[0];
    const media = mediaById.get(root);
    const sourceTitle = media?.title?.english ?? media?.title?.romaji;
    const displayName =
      tokyo?.title ??
      (sourceTitle ? candidateSeasonStem(sourceTitle) : undefined);
    if (!displayName) continue;
    const partialSeasonRoot =
      !tokyo &&
      component.length > 1 &&
      /(?:\bseason\s+[2-9]\d*|\b[2-9]\d*(?:nd|rd|th)\s+season|\s+[2-9]\d*)$/i.test(
        sourceTitle
      );
    for (const id of component)
      rules.push({
        media_id: id,
        series_media_id: root,
        binder_id: stableSeriesId(root),
        display_name: displayName,
        decision: partialSeasonRoot
          ? "B"
          : component.length > 1 || tokyo
            ? "A"
            : "C",
        editorial_approved: false,
        production_approved: false,
        reason:
          TOKYO_SERIES.get(id)?.reason ??
          (partialSeasonRoot
            ? "Only a later-season fragment is connected by A edges; resolve the original series before proposing a new binder."
            : component.length > 1
              ? "Direct season component; no franchise-wide closure."
              : "Independent source series, no approved merge.")
      });
  }
  // Guard against accidental transitive merges across explicit product boundaries.
  const original = rules.find(r => r.media_id === 20605),
    sequel = rules.find(r => r.media_id === 100240);
  if (original && sequel && original.binder_id === sequel.binder_id)
    throw new Error("Tokyo Ghoul series boundary violated");
  return { rules, pairs };
}

export function planFutureMedia(mediaId, origin, rules) {
  if (origin !== "anilist_confirmed")
    return {
      action: "protect",
      reason: "Manual, unknown or other-category import."
    };
  const rule = rules.find(row => row.media_id === mediaId);
  if (!rule || rule.decision !== "A" || rule.editorial_approved !== true)
    return {
      action: "review",
      reason:
        "New or unapproved media; never inherit a franchise or title-prefix mapping."
    };
  return { action: "assign", binder_id: rule.binder_id, media_id: mediaId };
}
