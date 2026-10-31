import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** Canonical UTC keys retain PostgreSQL microseconds; JS Date would merge draws. */
export function forensicTimestamp(value) {
  const match = String(value).match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/
  );
  assert(
    match,
    "An explicit UTC timestamp with at most microsecond precision is required"
  );
  return `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(6, "0")}Z`;
}

const digest = value =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const integer = value => {
  const number = Number(value);
  assert(
    value !== null &&
      value !== undefined &&
      Number.isSafeInteger(number) &&
      number >= 0
  );
  return number;
};

/**
 * Offline, no writes. PROVEN requires a closed and independently checked window,
 * not a temporal match or an assumed FIFO order of referral credit lots.
 */
export function reconstructReferralWindow(input) {
  const {
    actorId,
    before,
    after,
    acquisitions = [],
    credits = [],
    controls
  } = input;
  const start = forensicTimestamp(before.at),
    end = forensicTimestamp(after.at);
  assert(start < end, "Invalid checkpoint order");
  const beforeBonus = integer(before.bonus),
    afterBonus = integer(after.bonus);
  const delta = integer(after.regularOpened) - integer(before.regularOpened);
  assert(delta >= 0, "Counter reset invalidates reconstruction");
  const beforeIds = new Set(
    before.cards.filter(card => card.ownerId === actorId).map(card => card.id)
  );
  const acquisitionIds = new Set(
    acquisitions.map(acquisition => acquisition.instanceId)
  );
  const seen = new Set();
  for (const card of after.cards) {
    assert(!seen.has(card.id), "Duplicate instance in checkpoint");
    seen.add(card.id);
  }
  const newlyOwned = after.cards.filter(
    card => card.ownerId === actorId && !beforeIds.has(card.id)
  );
  const excludedAcquisitions = newlyOwned.filter(card =>
    acquisitionIds.has(card.id)
  );
  const candidates = newlyOwned.filter(card => !acquisitionIds.has(card.id));
  const groups = new Map();
  let validRows = true;
  for (const card of candidates) {
    const at = forensicTimestamp(card.obtainedAt);
    if (at <= start || at >= end || card.isEvolved) validRows = false;
    if (!groups.has(at)) groups.set(at, []);
    groups.get(at).push(card);
  }
  const sortedGroups = [...groups].sort(([a], [b]) => a.localeCompare(b));
  const normalizedCredits = credits
    .map(credit => ({
      ...credit,
      at: forensicTimestamp(credit.at),
      packs: integer(credit.packs)
    }))
    .filter(credit => credit.at > start && credit.at < end);
  assert.equal(
    new Set(normalizedCredits.map(credit => credit.id)).size,
    normalizedCredits.length,
    "Duplicate credit event"
  );
  const tiedEvents = normalizedCredits.some(credit => groups.has(credit.at));
  const gates = {
    archiveIntegrity: controls?.archiveIntegrity === true,
    rulesVerified: controls?.rulesVerified === true,
    sourceHistoryComplete: controls?.sourceHistoryComplete === true,
    alternateCreatorsExcluded: controls?.alternateCreatorsExcluded === true,
    noCounterReset: controls?.noCounterReset === true,
    decisionCounterUnchanged:
      integer(before.decisionCompleted) === integer(after.decisionCompleted),
    exactCardConservation: candidates.length === delta * 5,
    exactOpeningGroups:
      groups.size === delta &&
      sortedGroups.every(([, cards]) => cards.length === 5),
    validRows,
    noTimestampTies: !tiedEvents
  };
  const complete = Object.values(gates).every(Boolean);
  const openingCandidates = sortedGroups.map(([at, cards]) => ({
    // This is a forensic key, never a fictional database pack identifier.
    forensicOpeningId: digest({
      actorId,
      start,
      end,
      at,
      ids: cards.map(card => card.id).sort()
    }),
    databasePackId: null,
    actorId,
    observedObtainedAt: at,
    openingTimestamp: complete ? at : null,
    instanceIds: cards.map(card => card.id).sort(),
    confidence: "POSSIBLE",
    sourceReferralId: null,
    possibleSourceReferralIds: [],
    attributionScope: "UNVERIFIED",
    bonusBefore: null,
    bonusAfter: null,
    stateEvidence: "NO_REPLAY_WHEN_WINDOW_INCOMPLETE"
  }));
  let replay = null;
  if (complete) {
    let bonus = beforeBonus,
      badMin = 0,
      badMax = beforeBonus;
    let badSources = new Set();
    const events = normalizedCredits
      .map(credit => ({ ...credit, kind: "credit" }))
      .concat(
        openingCandidates.map(opening => ({
          at: opening.observedObtainedAt,
          kind: "opening",
          opening
        }))
      )
      .sort((a, b) => a.at.localeCompare(b.at));
    for (const event of events) {
      if (event.kind === "credit") {
        bonus += event.packs;
        if (event.scope === "DISPOSABLE_SPONSOR") {
          badMin += event.packs;
          badMax += event.packs;
          badSources.add(event.referralId);
        }
        continue;
      }
      const opening = event.opening;
      opening.bonusBefore = bonus;
      if (bonus > 0) {
        opening.possibleSourceReferralIds = [...badSources].sort();
        if (badMin === bonus && badSources.size > 0) {
          opening.confidence = "PROVEN";
          opening.attributionScope =
            "ALL_POSSIBLE_BONUS_SOURCES_ARE_DISPOSABLE_SPONSOR_CREDITS";
          if (badSources.size === 1)
            opening.sourceReferralId = [...badSources][0];
        } else if (badMax > 0) {
          opening.confidence = "HIGH_CONFIDENCE";
          opening.attributionScope = "MIXED_OR_UNATTRIBUTED_BONUS_POOL";
        } else {
          opening.confidence = "UNVERIFIED";
          opening.attributionScope = "EXCLUDED_OTHER_BONUS_SOURCE";
        }
        bonus--;
        badMin = Math.max(0, badMin - 1);
        badMax = Math.min(bonus, badMax);
        if (bonus === 0) badSources = new Set();
      } else {
        opening.confidence = "UNVERIFIED";
        opening.attributionScope = "EXCLUDED_TIMED_RESERVE";
      }
      opening.bonusAfter = bonus;
      opening.stateEvidence =
        "RECONSTRUCTED_FROM_CLOSED_ARCHIVE_WINDOW_NOT_A_DIRECT_COUNTER_LOG";
    }
    replay = { expectedBonusAfter: bonus, observedBonusAfter: afterBonus };
    gates.counterBalance = bonus === afterBonus;
    if (!gates.counterBalance) {
      for (const opening of openingCandidates) {
        opening.confidence = "POSSIBLE";
        opening.attributionScope = "UNVERIFIED_COUNTER_MISMATCH";
        opening.sourceReferralId = null;
        opening.openingTimestamp = null;
        opening.bonusBefore = opening.bonusAfter = null;
      }
    }
  } else gates.counterBalance = false;
  const proven = openingCandidates.filter(
    opening => opening.confidence === "PROVEN"
  );
  return {
    actorId,
    start,
    end,
    gates,
    replay,
    archiveEvidence: input.archiveEvidence ?? [],
    beforeBonus,
    afterBonus,
    regularOpeningDelta: delta,
    expectedCreatedCards: delta * 5,
    observedNewCandidateCards: candidates.length,
    excludedAcquisitionIds: excludedAcquisitions.map(card => card.id),
    openingCandidates,
    provenOpeningCount: proven.length,
    provenInstanceIds: proven.flatMap(opening => opening.instanceIds),
    writesExecuted: 0,
    sanctionsAuthorized: false
  };
}
