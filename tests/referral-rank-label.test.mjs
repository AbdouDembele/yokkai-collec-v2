import assert from "node:assert/strict";
import test from "node:test";
import { referralRankLabel } from "../lib/referrals/rank.mjs";

test("referral badges show exact places through 500, then percentages", () => {
  assert.equal(referralRankLabel({ position: 1, topPercent: 10 }), "Top 1");
  assert.equal(referralRankLabel({ position: 10, topPercent: 100 }), "Top 10");
  assert.equal(referralRankLabel({ position: 499, topPercent: 20 }), "Top 499");
  assert.equal(referralRankLabel({ position: 500, topPercent: 20 }), "Top 500");
  assert.equal(referralRankLabel({ position: 501, topPercent: 20 }), "Top 20%");
  assert.equal(
    referralRankLabel({ position: 1000, topPercent: 40 }),
    "Top 40%"
  );
});

test("unranked referrals do not receive a misleading top badge", () => {
  assert.equal(referralRankLabel(null), null);
  assert.equal(referralRankLabel(undefined), null);
  assert.equal(referralRankLabel({ position: null, topPercent: null }), null);
  assert.equal(referralRankLabel({ position: 0, topPercent: 10 }), null);
  assert.equal(
    referralRankLabel({ position: 500, topPercent: null }),
    "Top 500"
  );
  assert.equal(referralRankLabel({ position: 501, topPercent: null }), null);
});
