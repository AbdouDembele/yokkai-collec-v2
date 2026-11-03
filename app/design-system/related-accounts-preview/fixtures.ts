import type {
  RelatedAccountData,
  RelatedAccount
} from "@/app/admin/security/related-account-picker";

export const fixtureSubject = "ac680000-0000-4000-8000-000000000001";
const row = (n: number, values: Partial<RelatedAccount>): RelatedAccount => ({
  userId: `ac680000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  pseudo: "Example collector",
  email: `collector${n}@example.invalid`,
  accountState: { deleted: false, banned: false, sanctionApplied: false },
  removed: false,
  archived: false,
  acceptedTrades: 2,
  soldAuctions: 0,
  availableTransfers: 2,
  cardsToSubject: 12,
  cardsFromSubject: 3,
  karasToSubject: 200,
  karasFromSubject: 30,
  sharedNetwork: false,
  sharedBrowser: false,
  ...values
});
export const fixtureAccounts: RelatedAccount[] = [
  row(2, { pseudo: "Faker", sharedNetwork: true }),
  row(3, {
    pseudo: "Former collector with a long archived username",
    email: "former.collector.with.a.long.address@example.invalid",
    removed: true,
    archived: true,
    accountState: {
      deleted: true,
      banned: false,
      sanctionApplied: false,
      deletionOrigin: "self"
    },
    acceptedTrades: 4,
    soldAuctions: 3,
    availableTransfers: 7,
    cardsToSubject: 31,
    cardsFromSubject: 0,
    karasToSubject: 1150,
    karasFromSubject: 100,
    sharedBrowser: true
  }),
  row(4, {
    pseudo: "Sanctioned source",
    removed: true,
    archived: true,
    accountState: {
      deleted: true,
      banned: false,
      sanctionApplied: true,
      deletionOrigin: "unknown"
    },
    availableTransfers: 0
  }),
  row(5, {
    pseudo: "Termipoison",
    acceptedTrades: 8,
    cardsToSubject: 40,
    cardsFromSubject: 8,
    karasToSubject: 1024,
    karasFromSubject: 150
  }),
  row(6, {
    pseudo: "Shared household",
    acceptedTrades: 0,
    availableTransfers: 0,
    cardsToSubject: 0,
    cardsFromSubject: 0,
    karasToSubject: 0,
    karasFromSubject: 0,
    sharedNetwork: true,
    sharedBrowser: true
  }),
  row(7, {
    pseudo: "Banned collector",
    accountState: { deleted: false, banned: true, sanctionApplied: true },
    availableTransfers: 0
  })
];
export function relatedFixture(
  query = "",
  status = "",
  page = 1,
  removed = false
): RelatedAccountData {
  const matches = fixtureAccounts.filter(
    a =>
      (!query ||
        `${a.pseudo} ${a.email}`.toLowerCase().includes(query.toLowerCase())) &&
      (!status ||
        (status === "active" &&
          !a.accountState.deleted &&
          !a.accountState.banned) ||
        (status === "banned" && a.accountState.banned) ||
        (["deleted", "archived"].includes(status) && a.removed))
  );
  return {
    subject: {
      userId: fixtureSubject,
      pseudo: "Case collector",
      deleted: removed,
      removed,
      banned: false,
      sanctionApplied: false,
      deletionOrigin: "unknown"
    },
    accounts: matches.slice((page - 1) * 3, page * 3),
    total: matches.length,
    relatedTotal: fixtureAccounts.length,
    pageSize: 3,
    counts: { active: 3, banned: 1, deleted: 2 }
  };
}
