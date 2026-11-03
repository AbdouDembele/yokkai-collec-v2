import { getTranslations } from "next-intl/server";
import {
  AccountStatus,
  EventDetail,
  type AccountState
} from "@/app/admin/security/event-detail";
import { DeletedAccountHistory } from "@/app/admin/security/deleted-account-history";

export default async function Page() {
  const t = await getTranslations("adminSecurity");
  const processed: AccountState = {
    deleted: true,
    banned: false,
    deletionOrigin: "unknown",
    sanctionApplied: true,
    sanctionAppliedAt: "2026-11-03T15:02:12Z",
    pseudo: "Former collector"
  };
  const self: AccountState = {
    deleted: true,
    banned: false,
    deletionOrigin: "self",
    sanctionApplied: false,
    pseudo: "Self-deleted collector"
  };
  const banned: AccountState = {
    deleted: false,
    banned: true,
    sanctionApplied: true,
    pseudo: "Banned collector"
  };
  const both: AccountState = {
    ...self,
    bannedAtDeletion: true,
    pseudo: "Deleted after a ban"
  };
  const examples = [processed, self, banned, both];
  return (
    <main className="mx-auto min-w-0 max-w-6xl space-y-5 p-3 sm:p-6">
      <h1 className="text-xl font-black">{t("metadataTitle")}</h1>
      <section className="min-w-0 rounded-2xl border border-slate-700 bg-slate-900/70 p-3 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold">Main collector</h2>
          <AccountStatus state={{ ...banned, banned: false }} />
        </div>
        <ul className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
          {examples.map((state, i) => (
            <li
              key={i}
              className="min-w-0 rounded-lg bg-slate-950 p-3 [overflow-wrap:anywhere]"
            >
              <p className="mb-2 font-bold">{state.pseudo}</p>
              <AccountStatus state={state} />
            </li>
          ))}
        </ul>
      </section>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <DeletedAccountHistory
          primaryId="ac650000-0000-4000-8000-000000000002"
          data={{
            accounts: [processed, self, both].map((state, i) => ({
              userId: `ac650000-0000-4000-8000-${String(i + 3).padStart(12, "0")}`,
              pseudo: state.pseudo ?? null,
              email: `fixture${i}@example.invalid`,
              deletedAt: "2026-11-03T14:00:00Z",
              identityExpiresAt: "2027-02-01T14:00:00Z",
              identitySource: "deletion_snapshot",
              transfers: 1,
              availableTransfers: i === 0 ? 0 : 1,
              accountState: state
            })),
            total: 3,
            deletedTotal: 3,
            pageSize: 30
          }}
          preview={null}
          selected={[]}
          query=""
          relatedOnly
          page={1}
          applied={false}
        />
        <aside className="min-w-0 rounded-xl border border-slate-700 p-3">
          <h2 className="mb-3 font-bold">{t("eventsTitle")}</h2>
          <AccountStatus state={processed} />
          <EventDetail
            detail={{
              kind: "trade",
              source: "captured",
              available: true,
              fromState: processed,
              toState: { ...banned, banned: false, pseudo: "Main collector" },
              offeredCards: [
                { name: "BROLY", rarity: "LR", franchise: "Dragon Ball" }
              ],
              requestedCards: [],
              offeredCount: 1,
              requestedCount: 0,
              offeredKaras: 15,
              requestedKaras: 0
            }}
          />
        </aside>
      </div>
    </main>
  );
}
