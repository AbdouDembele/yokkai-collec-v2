import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hash = value =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sum = values => values.reduce((total, value) => total + value, 0);
const byId = values =>
  new Map(values.map(value => [value.id ?? value.user_id, value]));

/** Observations are evidence of transactions, never proof of a pack's origin. */
export function analyzeReferralAudit(snapshot, reviews = []) {
  const { scope, economy, correlations, domainHistory } = snapshot;
  assert(
    scope && economy && correlations && domainHistory,
    "Incomplete audit snapshot"
  );
  assert.equal(
    scope.registry,
    correlations.ruleSnapshot.registry,
    "Schema changed during audit"
  );
  for (const section of [economy, correlations, domainHistory])
    assert.equal(
      section.snapshot,
      scope.snapshot,
      "A single coherent snapshot is required"
    );
  assert.equal(
    scope.referralCodeOwnerMismatches,
    0,
    "Referral code ownership is inconsistent"
  );
  assert.equal(
    scope.metadataEvidence.regularPackRows,
    0,
    "Provenance schema changed: review the audit model"
  );
  const disposables = byId(scope.disposable);
  const profiles = byId(scope.referrerStats);
  const stats = byId(economy.actorStats);
  const reviewMap = byId(reviews);
  assert.equal(reviewMap.size, reviews.length, "Duplicate case review");
  const sponsorIds = [
    ...new Set(scope.referrals.map(referral => referral.referrer_id))
  ].sort();
  for (const review of reviews) {
    assert(sponsorIds.includes(review.user_id), "Unknown reviewed sponsor");
    assert(
      ["LOW_SUSPICION", "HIGH_SUSPICION", "MANIFEST_FRAUD"].includes(
        review.level
      )
    );
    assert.equal(typeof review.reason, "string");
    assert(review.reason.length > 10, "A reasoned human review is required");
    assert.notEqual(
      review.level,
      "MANIFEST_FRAUD",
      "Current export cannot establish full pack lineage"
    );
  }
  const cases = sponsorIds.map(userId => {
    const profile = profiles.get(userId);
    assert(profile, "Missing sponsor profile");
    const referrals = scope.referrals.filter(
      referral => referral.referrer_id === userId
    );
    const rewarded = referrals.filter(referral => referral.rewarded_at);
    const children = new Set(referrals.map(referral => referral.referred_id));
    const firstReward = rewarded
      .map(referral => referral.rewarded_at)
      .sort()[0];
    const sales = economy.auctions.filter(
      auction => auction.status === "sold" && auction.seller_id === userId
    );
    const salesAfter = sales.filter(
      sale => firstReward && Date.parse(sale.ends_at) >= Date.parse(firstReward)
    );
    const trades = economy.trades.filter(
      trade =>
        trade.status === "accepted" &&
        [trade.from_user, trade.to_user].includes(userId)
    );
    const childTrades = trades.filter(
      trade => children.has(trade.from_user) || children.has(trade.to_user)
    );
    const review = reviewMap.get(userId);
    const receipts = referrals.map(referral => {
      const child = disposables.get(referral.referred_id);
      assert(child, "Missing disposable account");
      const signups = domainHistory.events.filter(
        event => event.user_id === child.id && event.action === "user_signedup"
      );
      return {
        referral,
        account: child,
        activity: stats.get(child.id),
        signupDomainEvidence: signups,
        disposableAtSignupObserved: signups.some(
          event => event.domain_disposable
        ),
        evidenceStatus: referral.rewarded_at
          ? "DISPOSABLE_REFERRAL_REWARD_RECORDED"
          : "UNREWARDED_REFERRAL",
        sponsorRewardPacks: referral.rewarded_at ? referral.reward_packs : 0,
        packIds: [],
        packToCardProvenance: "UNVERIFIED"
      };
    });
    return {
      userId,
      pseudo: profile.pseudo,
      currentBalance: profile.karas_balance,
      currentBonusPacks: profile.bonus_regular_packs,
      lifetimeRegularPacksOpened: profile.lifetime_regular_packs_opened,
      totalReferrals: profile.total_referrals,
      disposableReferrals: referrals.length,
      rewardedReferrals: rewarded.length,
      recordedSponsorRewardPacks: sum(
        rewarded.map(referral => referral.reward_packs)
      ),
      review: review ?? {
        level: "NOT_REVIEWED",
        reason: "Manual review required"
      },
      referrals: receipts,
      sales,
      trades,
      childTrades,
      observedSalesProceeds: sum(sales.map(sale => sale.current_price)),
      observedSalesProceedsAfterFirstReward: sum(
        salesAfter.map(sale => sale.current_price)
      ),
      // Unknown is not zero fraud. Zero below is only the safe executable recovery.
      provenFraudulentCards: [],
      provenFraudulentSaleProceeds: null,
      safeCardRecovery: 0,
      safeKaraRecovery: 0,
      shortage: null,
      mainBanProposed: false,
      mainFlagProposed: review?.level === "HIGH_SUSPICION",
      childBanCandidates:
        review?.level === "HIGH_SUSPICION"
          ? receipts
              .filter(
                receipt =>
                  receipt.sponsorRewardPacks > 0 &&
                  receipt.disposableAtSignupObserved &&
                  receipt.activity?.is_admin === false
              )
              .map(receipt => ({
                userId: receipt.account.id,
                referralId: receipt.referral.id,
                reason:
                  "Repeated rewarded disposable-referral cohort; human approval required"
              }))
          : []
    };
  });
  const protectedTransfers = economy.trades.filter(
    trade => trade.status === "accepted"
  );
  const cardObservations = economy.instances.map(instance => ({
    ...instance,
    provenance: "UNVERIFIED",
    fraudStatus: "UNKNOWN",
    auctionIds: economy.auctions
      .filter(sale => sale.card_instance_id === instance.instance_id)
      .map(sale => sale.id),
    acceptedTradeIds: protectedTransfers
      .filter(trade =>
        [...trade.offered_card_ids, ...trade.requested_card_ids].includes(
          instance.instance_id
        )
      )
      .map(trade => trade.id),
    proposedRemoval: false
  }));
  const graph = {
    semantics:
      "Only recorded relationships are edges. No inferred reward-to-card edge.",
    nodes: [
      ...scope.referrerStats.map(profile => ({
        id: profile.id,
        type: "ACCOUNT"
      })),
      ...scope.referrals.map(referral => ({
        id: referral.id,
        type: "REFERRAL"
      }))
    ],
    edges: scope.referrals
      .flatMap(referral => [
        {
          from: referral.referred_id,
          to: referral.id,
          type: "USED_REFERRAL",
          evidence: referral.id
        },
        {
          from: referral.id,
          to: referral.referrer_id,
          type: "SPONSOR",
          evidence: referral.id
        },
        ...(referral.rewarded_at
          ? [
              {
                from: referral.id,
                to: referral.referrer_id,
                type: "BONUS_PACK_CREDIT",
                amount: referral.reward_packs,
                at: referral.rewarded_at,
                evidence: referral.id
              }
            ]
          : [])
      ])
      .concat(
        protectedTransfers.flatMap(trade => [
          {
            from: trade.from_user,
            to: trade.to_user,
            type: "TRADE_TRANSFER",
            instanceIds: trade.offered_card_ids,
            kara: trade.offered_karas,
            evidence: trade.id,
            fraudProvenance: "UNVERIFIED"
          },
          {
            from: trade.to_user,
            to: trade.from_user,
            type: "TRADE_TRANSFER",
            instanceIds: trade.requested_card_ids,
            kara: trade.requested_karas,
            evidence: trade.id,
            fraudProvenance: "UNVERIFIED"
          }
        ])
      )
  };
  const summary = {
    disposableAccounts: scope.disposable.length,
    disposableAccountsWithReferral: scope.referrals.length,
    sponsors: cases.length,
    recordedRewardedDisposableReferrals: sum(
      cases.map(item => item.rewardedReferrals)
    ),
    recordedSponsorRewardPacks: sum(
      cases.map(item => item.recordedSponsorRewardPacks)
    ),
    confirmedFraudCases: null,
    identifiedIllegitimatePackIds: 0,
    attributableCards: null,
    attributableSaleKara: null,
    observedInstanceIds: cardObservations.length,
    unknownProvenanceInstances: cardObservations.length,
    missingCurrentInstances: cardObservations.filter(
      card => !card.current_user_id
    ).length,
    childBanCandidates: sum(cases.map(item => item.childBanCandidates.length)),
    mainFlagsProposed: cases.filter(item => item.mainFlagProposed).length,
    mainBansProposed: 0,
    removedCardsPlanned: 0,
    karaRecoveryPlanned: 0,
    popupRecipientsInSafePlan: 0,
    mainAccountsAwaitingSanctionDecision: cases.filter(
      item => item.mainFlagProposed
    ).length,
    recoveryPopupReady: false,
    liveSanctionsApplied: 0,
    livePopupsCreated: 0,
    ipEventsAvailable: correlations.actorIpCoverage,
    sharedIpPairs: correlations.sharedIpSignals.length
  };
  const candidates = cases.flatMap(item =>
    item.childBanCandidates.map(candidate => ({
      operationId: hash({ type: "PROPOSE_DISABLE", ...candidate }),
      ...candidate,
      sponsorId: item.userId,
      expectedBefore: disposables.get(candidate.userId),
      status: "REQUIRES_EXPLICIT_POST_REPORT_APPROVAL"
    }))
  );
  const manifest = {
    mode: "DRY_RUN",
    executable: false,
    sourceSnapshotSha256: hash(snapshot),
    reviewsSha256: hash(reviews),
    snapshotAt: scope.snapshot,
    safety: {
      mustRefreshSnapshot: true,
      mustBackupAndValidateRestore: true,
      mustApproveAfterReadingReport: true,
      allowNegativeBalance: false,
      hardDeleteAccounts: false,
      removeInnocentAssets: false,
      sendNotificationNow: false
    },
    phases: [
      { phase: 1, name: "DISABLE_REVIEWED_SECONDARY_ACCOUNTS", candidates },
      {
        phase: 2,
        name: "REMOVE_PROVEN_CARDS_STILL_OWNED_BY_OFFENDER",
        operations: [],
        blocker: "UNVERIFIED_PACK_TO_CARD_LINEAGE"
      },
      {
        phase: 3,
        name: "RECOVER_EXACT_HISTORICAL_SALE_KARA",
        operations: [],
        blocker: "UNVERIFIED_PACK_TO_CARD_LINEAGE"
      },
      {
        phase: 4,
        name: "REVIEW_TRADES_BETWEEN_FLAGGED_ACCOUNTS",
        tradeIds: economy.trades
          .filter(
            trade =>
              trade.status === "accepted" &&
              cases.some(
                item => item.mainFlagProposed && item.userId === trade.from_user
              ) &&
              cases.some(
                item => item.mainFlagProposed && item.userId === trade.to_user
              )
          )
          .map(trade => trade.id),
        operations: []
      },
      {
        phase: 5,
        name: "FLAG_MAIN_ACCOUNTS_FOR_REVIEW",
        candidates: cases
          .filter(item => item.mainFlagProposed)
          .map(item => ({
            userId: item.userId,
            reason: item.review.reason,
            cardsRemoved: 0,
            karaRemoved: 0,
            popup: false,
            status: "INTERNAL_REVIEW_FLAG_ONLY"
          }))
      },
      {
        phase: 6,
        name: "INTEGRITY_AND_RECEIPTS",
        checks: [
          "No unapproved user changed",
          "No innocent owner or balance changed",
          "No historical transaction removed",
          "No duplicate adjustment",
          "No negative balance",
          "No notification without committed sanction",
          "Journal actual before/after values",
          "Rollback guarded by after-image"
        ]
      },
      {
        phase: 7,
        name: "FINAL_REPORT_AND_NOTIFICATION",
        status: "BLOCKED_UNTIL_APPROVED_APPLY_COMMITS",
        popupSource: "Committed sanction receipt, never dry-run estimates"
      }
    ]
  };
  return { summary, cases, cardObservations, graph, manifest };
}

function csv(rows) {
  return (
    rows
      .map(row =>
        row
          .map(value => '"' + String(value ?? "").replaceAll('"', '""') + '"')
          .join(",")
      )
      .join("\n") + "\n"
  );
}

export function writeAuditArtifacts(result, directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const write = (name, value) =>
    writeFileSync(
      resolve(directory, name),
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
      { mode: 0o600 }
    );
  write("summary.json", result.summary);
  write("cases.json", result.cases);
  write("cards.json", result.cardObservations);
  write("graph.json", result.graph);
  write("apply-plan.json", result.manifest);
  write(
    "cases.csv",
    csv([
      [
        "user_id",
        "pseudo",
        "suspicion",
        "disposable_referrals",
        "recorded_sponsor_packs",
        "balance",
        "cards_to_remove",
        "kara_to_remove",
        "fraud_provenance"
      ],
      ...result.cases.map(item => [
        item.userId,
        item.pseudo,
        item.review.level,
        item.disposableReferrals,
        item.recordedSponsorRewardPacks,
        item.currentBalance,
        0,
        0,
        "UNVERIFIED"
      ])
    ])
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  assert(
    args.length === 3 && !args.some(arg => arg.startsWith("--")),
    "Usage: node scripts/referral-fraud-dry-run.mjs snapshot.json reviews.json .tools/private-output (no APPLY mode)"
  );
  const root = fileURLToPath(new URL("../", import.meta.url));
  const directory = resolve(args[2]);
  const outputRelative = relative(resolve(root, ".tools"), directory);
  assert(
    outputRelative &&
      !outputRelative.startsWith(".." + sep) &&
      outputRelative !== ".." &&
      !isAbsolute(outputRelative),
    "Output must stay inside the ignored .tools directory of this checkout"
  );
  const envelope = JSON.parse(readFileSync(args[0], "utf8"));
  assert.equal(
    envelope.readOnly,
    true,
    "An explicit read-only export receipt is required"
  );
  const result = analyzeReferralAudit(
    envelope.data,
    JSON.parse(readFileSync(args[1], "utf8"))
  );
  writeAuditArtifacts(result, directory);
  console.log(JSON.stringify(result.summary));
}
