import assert from "node:assert/strict";
import test from "node:test";
import { analyzeReferralAudit } from "../scripts/referral-fraud-dry-run.mjs";

function fixture() {
  return {
    scope: {
      registry: "20261031170000",
      snapshot: "2026-10-31T18:00:00Z",
      metadataEvidence: { regularPackRows: 0 },
      referralCodeOwnerMismatches: 0,
      disposable: [{ id: "child", pseudo: "Child", karas_balance: 5 }],
      referrerStats: [
        {
          id: "main",
          pseudo: "Main",
          karas_balance: 1,
          bonus_regular_packs: 0,
          lifetime_regular_packs_opened: 100,
          total_referrals: 1
        }
      ],
      referrals: [
        {
          id: "referral",
          referrer_id: "main",
          referred_id: "child",
          reward_packs: 5,
          rewarded_at: "2026-10-30T18:00:00Z"
        }
      ]
    },
    economy: {
      snapshot: "2026-10-31T18:00:00Z",
      actorStats: [{ user_id: "child", is_admin: false }],
      instances: [
        {
          instance_id: "card",
          current_user_id: "innocent",
          obtained_at: "2026-10-30T18:00:00Z"
        }
      ],
      auctions: [
        {
          id: "sale",
          card_instance_id: "card",
          seller_id: "main",
          buyer_id: "innocent",
          status: "sold",
          current_price: 8000,
          ends_at: "2026-10-30T19:00:00Z"
        }
      ],
      trades: [
        {
          id: "trade",
          from_user: "child",
          to_user: "main",
          status: "accepted",
          offered_card_ids: ["card"],
          requested_card_ids: [],
          offered_karas: 59,
          requested_karas: 0
        }
      ]
    },
    correlations: {
      snapshot: "2026-10-31T18:00:00Z",
      ruleSnapshot: { registry: "20261031170000" },
      actorIpCoverage: 0,
      sharedIpSignals: []
    },
    domainHistory: {
      snapshot: "2026-10-31T18:00:00Z",
      events: [
        { user_id: "child", action: "user_signedup", domain_disposable: true }
      ]
    }
  };
}

const highReview = [
  {
    user_id: "main",
    level: "HIGH_SUSPICION",
    reason: "Manually reviewed cohort and transfer pattern"
  }
];

test("recorded reward is counted but matching timestamps, consumed bonus and transactions never establish card provenance", () => {
  const result = analyzeReferralAudit(fixture(), highReview);
  assert.equal(result.summary.recordedSponsorRewardPacks, 5);
  assert.equal(result.cases[0].observedSalesProceeds, 8000);
  assert.equal(result.cases[0].safeKaraRecovery, 0);
  assert.equal(result.cases[0].provenFraudulentSaleProceeds, null);
  assert.equal(
    result.cases[0].shortage,
    null,
    "Unknown fraud must not become an invented debt"
  );
  assert.equal(result.cardObservations[0].fraudStatus, "UNKNOWN");
  assert.equal(result.cardObservations[0].proposedRemoval, false);
  assert.deepEqual(result.manifest.phases[1].operations, []);
  assert.deepEqual(result.manifest.phases[2].operations, []);
  assert.equal(result.manifest.safety.allowNegativeBalance, false);
});

test("unreviewed sponsors, one isolated email signal, unverified signup history and innocent buyers do not produce bans or popups", () => {
  const source = fixture();
  const unreviewed = analyzeReferralAudit(source);
  assert.equal(unreviewed.summary.childBanCandidates, 0);
  const low = analyzeReferralAudit(source, [
    { ...highReview[0], level: "LOW_SUSPICION" }
  ]);
  assert.equal(low.summary.mainFlagsProposed, 0);
  assert.equal(low.summary.childBanCandidates, 0);
  source.domainHistory.events = [];
  const missingHistory = analyzeReferralAudit(source, highReview);
  assert.equal(missingHistory.summary.childBanCandidates, 0);
  assert.equal(missingHistory.summary.popupRecipientsInSafePlan, 0);
  assert.equal(missingHistory.summary.livePopupsCreated, 0);
  assert.equal(missingHistory.manifest.executable, false);
  assert(
    !missingHistory.manifest.phases.some(phase =>
      phase.candidates?.some(candidate => candidate.userId === "innocent")
    )
  );
});

test("unrewarded referrals and admin accounts are excluded from proposed secondary bans", () => {
  const source = fixture();
  source.scope.referrals[0].rewarded_at = null;
  let result = analyzeReferralAudit(source, highReview);
  assert.equal(result.summary.recordedSponsorRewardPacks, 0);
  assert.equal(result.summary.childBanCandidates, 0);
  source.scope.referrals[0].rewarded_at = "2026-10-30T18:00:00Z";
  source.economy.actorStats[0].is_admin = true;
  result = analyzeReferralAudit(source, highReview);
  assert.equal(result.summary.childBanCandidates, 0);
  source.economy.actorStats = [];
  result = analyzeReferralAudit(source, highReview);
  assert.equal(
    result.summary.childBanCandidates,
    0,
    "Missing admin status must fail closed"
  );
});

test("plans are deterministic, retain before-images and require explicit approval without creating any executable APPLY", () => {
  const a = analyzeReferralAudit(fixture(), highReview);
  const b = analyzeReferralAudit(fixture(), highReview);
  assert.deepEqual(a, b);
  assert.equal(a.summary.childBanCandidates, 1);
  const candidate = a.manifest.phases[0].candidates[0];
  assert.equal(candidate.status, "REQUIRES_EXPLICIT_POST_REPORT_APPROVAL");
  assert.equal(candidate.expectedBefore.id, "child");
  assert.equal(a.manifest.safety.sendNotificationNow, false);
  assert.equal(a.manifest.safety.hardDeleteAccounts, false);
  assert.equal(a.manifest.safety.removeInnocentAssets, false);
  assert(!a.graph.edges.some(edge => edge.type === "PACK_CREATED_CARD"));
});

test("new provenance schemas, unknown reviews and unsupported assertions fail closed", () => {
  const source = fixture();
  source.scope.metadataEvidence.regularPackRows = 1;
  assert.throws(
    () => analyzeReferralAudit(source),
    /Provenance schema changed/
  );
  assert.throws(
    () =>
      analyzeReferralAudit(fixture(), [
        { ...highReview[0], user_id: "unknown" }
      ]),
    /Unknown reviewed sponsor/
  );
  assert.throws(
    () =>
      analyzeReferralAudit(fixture(), [
        { ...highReview[0], level: "MANIFEST_FRAUD" }
      ]),
    /cannot establish full pack lineage/
  );
  assert.throws(
    () => analyzeReferralAudit(fixture(), [...highReview, ...highReview]),
    /Duplicate case review/
  );
});

test("mixed snapshots and inconsistent referral ownership are rejected before proposing any action", () => {
  const source = fixture();
  source.economy.snapshot = "2026-11-01T18:00:00Z";
  assert.throws(() => analyzeReferralAudit(source), /single coherent snapshot/);
  source.economy.snapshot = source.scope.snapshot;
  source.scope.referralCodeOwnerMismatches = 1;
  assert.throws(
    () => analyzeReferralAudit(source),
    /ownership is inconsistent/
  );
});
