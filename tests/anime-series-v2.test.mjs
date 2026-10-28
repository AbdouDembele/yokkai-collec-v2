import assert from "node:assert/strict";
import test from "node:test";
import {
  buildV2SeriesDecisions,
  validateReview,
  V2_REVIEW,
  V2_GROUPS,
  V2_TV_REVIEW
} from "../scripts/anime-series-v2-decisions.mjs";
import { stableSeriesId } from "../scripts/anime-series-provenance.mjs";

const fixture = (id, title, edges = []) => ({
  id,
  type: "ANIME",
  format: "TV",
  title: { english: title, romaji: title },
  startDate: { year: 2020 },
  relations: {
    edges: edges.map(([id, relationType]) => ({ node: { id }, relationType }))
  }
});

test("V2 covers every individual B pair with evidence and no production approval", () => {
  validateReview(V2_REVIEW);
  assert.equal(V2_REVIEW.pairs.filter(row => row.status === "A").length, 738);
  assert.equal(V2_REVIEW.pairs.filter(row => row.status === "C").length, 356);
  assert.deepEqual(
    V2_REVIEW.pairs
      .filter(row => row.status === "B")
      .map(row => row.review_index),
    [116]
  );
  assert.equal(V2_TV_REVIEW.pairs.length, 256);
  assert.equal(
    V2_TV_REVIEW.pairs.filter(row => row.status === "A").length,
    182
  );
  assert.throws(
    () => validateReview({ pairs: V2_REVIEW.pairs.slice(1) }),
    /1095/
  );
});

test("V2 distinguishes seasons and directly attached films from crossovers, remakes and independent series", () => {
  const ids = [
    20605, 20850, 100240, 102351, 21132, 21326, 235, 6115, 1412, 2685, 109261,
    163327, 21288, 104188, 137822, 163147, 9756, 11981, 934, 4896, 103275,
    97815, 103276, 103277, 116756, 2246, 151117, 110349, 170935
  ];
  const media = new Map(ids.map(id => [id, fixture(id, `MEDIA ${id}`)]));
  const rules = buildV2SeriesDecisions(media, ids).rules;
  const binder = id => rules.find(row => row.media_id === id).binder_id;
  for (const [a, b] of [
    [20605, 20850],
    [20605, 21132],
    [100240, 102351],
    [109261, 163327],
    [9756, 11981],
    [103275, 97815],
    [103275, 116756],
    [2246, 151117],
    [110349, 170935]
  ])
    assert.equal(binder(a), binder(b), `${a}/${b}`);
  for (const [a, b] of [
    [20605, 100240],
    [235, 6115],
    [1412, 6115],
    [21288, 104188],
    [137822, 163147],
    [934, 4896]
  ])
    assert.notEqual(binder(a), binder(b), `${a}/${b}`);
  assert.ok(
    rules.every(
      row =>
        row.editorial_approved === false && row.production_approved === false
    )
  );
});

test("V2 rejects indirect bridges across reviewed boundaries", () => {
  const ids = [235, 6115, 1412];
  const media = new Map(ids.map(id => [id, fixture(id, `MEDIA ${id}`)]));
  assert.throws(
    () =>
      buildV2SeriesDecisions(media, ids, [], V2_REVIEW, [
        {
          name: "Invalid crossover bridge",
          media_ids: ids,
          review_source: "synthetic"
        }
      ]),
    /Editorial boundary/
  );
});

test("historical shared labels cannot bridge explicitly distinct adaptations", () => {
  const ids = [11757, 124140];
  const media = new Map(ids.map(id => [id, fixture(id, `MEDIA ${id}`)]));
  assert.throws(
    () =>
      buildV2SeriesDecisions(media, ids, [], V2_REVIEW, [
        {
          name: "Original",
          media_ids: [11757],
          review_source: "explicit-editorial-review"
        },
        {
          name: "Progressive",
          media_ids: [124140],
          review_source: "explicit-editorial-review"
        },
        {
          name: "Invalid historical shared source",
          media_ids: ids,
          review_source: "historical"
        }
      ]),
    /Editorial boundary/
  );
  const tv = V2_GROUPS.groups.find(
    row => row.name === "If I See You in My Dreams (TV)"
  );
  const ova = V2_GROUPS.groups.find(
    row => row.name === "If I See You in My Dreams (OVA)"
  );
  assert.deepEqual(
    tv.members.map(row => [row.media_id, row.format]),
    [[718, "TV_SHORT"]]
  );
  assert.deepEqual(
    ova.members.map(row => [row.media_id, row.format]),
    [[715, "OVA"]]
  );
});

test("extending a V1 series preserves its binder UUID and does not infer membership for new media", () => {
  const media = new Map([
    [11617, fixture(11617, "High School DxD")],
    [15451, fixture(15451, "High School DxD NEW")],
    [9999999, fixture(9999999, "High School DxD: Unverified")]
  ]);
  const previous = [
    {
      media_id: 15451,
      series_media_id: 15451,
      binder_id: stableSeriesId(15451),
      decision: "A"
    }
  ];
  const rules = buildV2SeriesDecisions(
    media,
    [...media.keys()],
    previous,
    V2_REVIEW,
    V2_GROUPS.groups
  ).rules;
  const root = rules.find(row => row.media_id === 11617),
    later = rules.find(row => row.media_id === 15451),
    unknown = rules.find(row => row.media_id === 9999999);
  assert.equal(root.binder_id, previous[0].binder_id);
  assert.equal(root.binder_id, later.binder_id);
  assert.notEqual(root.binder_id, unknown.binder_id);
  assert.equal(unknown.decision, "C");
});
