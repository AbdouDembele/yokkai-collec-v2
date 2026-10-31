import assert from "node:assert/strict";
import test from "node:test";
import {
  forensicTimestamp,
  reconstructReferralWindow
} from "../scripts/referral-forensic-reconstruction.mjs";

function fixture() {
  const cards = Array.from({ length: 15 }, (_, index) => ({
    id: `instance-${index}`,
    ownerId: "sponsor",
    cardId: `catalogue-${index}`,
    obtainedAt: `2026-10-31 10:00:0${Math.floor(index / 5) + 2}.000001+00`,
    isEvolved: false
  }));
  return {
    actorId: "sponsor",
    before: {
      at: "2026-10-31T10:00:00Z",
      bonus: 0,
      regularOpened: 40,
      decisionCompleted: 2,
      cards: []
    },
    after: {
      at: "2026-10-31T10:10:00Z",
      bonus: 0,
      regularOpened: 43,
      decisionCompleted: 2,
      cards
    },
    credits: [
      {
        id: "credit-a",
        referralId: "ref-a",
        at: "2026-10-31T10:00:01.000001Z",
        packs: 1,
        scope: "DISPOSABLE_SPONSOR"
      },
      {
        id: "credit-b",
        referralId: "ref-b",
        at: "2026-10-31T10:00:01.000002Z",
        packs: 1,
        scope: "DISPOSABLE_SPONSOR"
      }
    ],
    controls: {
      archiveIntegrity: true,
      rulesVerified: true,
      sourceHistoryComplete: true,
      alternateCreatorsExcluded: true,
      noCounterReset: true
    }
  };
}

test("complete conserved history proves bonus-source membership without inventing a FIFO between referrals", () => {
  const result = reconstructReferralWindow(fixture());
  assert.equal(result.provenOpeningCount, 2);
  assert.equal(result.provenInstanceIds.length, 10);
  assert.equal(result.openingCandidates[0].sourceReferralId, null);
  assert.deepEqual(result.openingCandidates[0].possibleSourceReferralIds, [
    "ref-a",
    "ref-b"
  ]);
  assert.equal(
    result.openingCandidates[2].attributionScope,
    "EXCLUDED_TIMED_RESERVE"
  );
  assert.equal(result.writesExecuted, 0);
  assert.equal(result.sanctionsAuthorized, false);
});

test("one missing card or an incomplete opening sequence invalidates every automatic proof", () => {
  const input = fixture();
  input.after.cards.pop();
  const result = reconstructReferralWindow(input);
  assert.equal(result.provenOpeningCount, 0);
  assert.equal(result.gates.exactCardConservation, false);
  assert(
    result.openingCandidates.every(opening => opening.confidence === "POSSIBLE")
  );
  assert(
    result.openingCandidates.every(opening => opening.bonusBefore === null)
  );
});

test("a legitimate credit or a preexisting unallocated bonus pool cannot be assigned to disposable rewards by FIFO", () => {
  const input = fixture();
  input.credits[0].scope = "OTHER_SOURCE";
  let result = reconstructReferralWindow(input);
  assert.equal(result.provenOpeningCount, 0);
  assert.equal(result.openingCandidates[0].confidence, "HIGH_CONFIDENCE");
  input.before.bonus = 1;
  input.after.bonus = 1;
  result = reconstructReferralWindow(input);
  assert.equal(result.provenOpeningCount, 0);
});

test("incoming cards, Decision Pack changes and evolutions are never mistaken for regular draws", () => {
  const input = fixture();
  input.after.cards.push({
    id: "purchase",
    ownerId: "sponsor",
    obtainedAt: "2026-10-31T10:05:00Z",
    isEvolved: false
  });
  let result = reconstructReferralWindow(input);
  assert.equal(result.provenOpeningCount, 0);
  input.acquisitions = [
    { instanceId: "purchase", evidenceId: "recorded-sale" }
  ];
  result = reconstructReferralWindow(input);
  assert.equal(result.provenOpeningCount, 2);
  input.after.decisionCompleted++;
  assert.equal(reconstructReferralWindow(input).provenOpeningCount, 0);
  input.after.decisionCompleted--;
  input.after.cards[0].isEvolved = true;
  assert.equal(reconstructReferralWindow(input).provenOpeningCount, 0);
});

test("counter mismatches, unverified controls, simultaneous credit/draw and resets fail closed", () => {
  let input = fixture();
  input.after.bonus = 1;
  assert.equal(reconstructReferralWindow(input).provenOpeningCount, 0);
  input = fixture();
  input.controls.sourceHistoryComplete = false;
  assert.equal(reconstructReferralWindow(input).provenOpeningCount, 0);
  input = fixture();
  input.credits[0].at = input.after.cards[0].obtainedAt;
  assert.equal(reconstructReferralWindow(input).provenOpeningCount, 0);
  input = fixture();
  input.after.regularOpened = 0;
  assert.throws(() => reconstructReferralWindow(input), /Counter reset/);
});

test("timestamps retain microsecond ordering instead of merging distinct draws into one millisecond", () => {
  assert(
    forensicTimestamp("2026-10-31 10:00:01.000001+00") <
      forensicTimestamp("2026-10-31 10:00:01.000002+00")
  );
  assert.equal(
    forensicTimestamp("2026-10-31T10:00:01.1Z"),
    "2026-10-31T10:00:01.100000Z"
  );
  assert.throws(() => forensicTimestamp("2026-10-31 10:00:01"));
});
