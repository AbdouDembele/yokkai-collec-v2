import { getTranslations } from "next-intl/server";

export type AccountState = {
  pseudo?: string | null;
  deleted: boolean;
  banned: boolean;
  bannedAtDeletion?: boolean;
  deletionOrigin?: "self" | "unknown";
  sanctionApplied: boolean;
  sanctionAppliedAt?: string | null;
};

export async function AccountStatus({ state }: { state?: AccountState }) {
  const t = await getTranslations("adminSecurity.accountState");
  if (!state) return null;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 align-middle text-xs font-bold">
      {state.sanctionApplied && (
        <span className="rounded-md border border-red-400/60 bg-red-500/15 px-2 py-1 text-red-200">
          {t("sanctionApplied")}
        </span>
      )}
      {(state.banned || (state.deleted && state.bannedAtDeletion)) && (
        <span className="rounded-md border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-rose-200">
          {t(state.deleted ? "bannedBeforeDeletion" : "banned")}
        </span>
      )}
      {state.deleted && (
        <span className="rounded-md border border-slate-500/60 bg-slate-800 px-2 py-1 text-slate-200">
          {t(state.deletionOrigin === "self" ? "deletedByPlayer" : "deleted")}
        </span>
      )}
    </span>
  );
}

type EventCard = {
  instanceId?: string;
  name: string | null;
  rarity: string | null;
  franchise: string | null;
};
export type EventAssetDetail = {
  kind: "trade" | "auction" | "context";
  source: "captured" | "retained" | "unavailable";
  available: boolean;
  fromName?: string | null;
  toName?: string | null;
  fromState?: AccountState;
  toState?: AccountState;
  offeredCards?: EventCard[];
  requestedCards?: EventCard[];
  offeredCount?: number;
  requestedCount?: number;
  offeredKaras?: number;
  requestedKaras?: number;
  cards?: EventCard[];
  amount?: number;
  startingPrice?: number;
};

export async function EventDetail({ detail }: { detail?: EventAssetDetail }) {
  const t = await getTranslations("adminSecurity.eventDetail");
  if (!detail?.available)
    return (
      <p className="border-t border-slate-700 pt-3 text-sm text-slate-400">
        {t("unavailable")}
      </p>
    );
  const cards = (items: EventCard[], count: number) => (
    <>
      {items.length ? (
        <ul className="mt-2 space-y-2">
          {items.map((card, index) => (
            <li
              key={card.instanceId ?? index}
              className="min-w-0 rounded-lg bg-slate-900 p-2 text-sm [overflow-wrap:anywhere]"
            >
              <p className="font-bold text-slate-100">
                {card.name ?? t("unknownCard")}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {[card.rarity, card.franchise].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-400">{t("noCards")}</p>
      )}
      {count > items.length && (
        <p className="mt-2 text-xs text-amber-100">
          {t("limited", { shown: items.length, total: count })}
        </p>
      )}
    </>
  );
  return (
    <div className="min-w-0 space-y-3 border-t border-slate-700 pt-3 [overflow-wrap:anywhere]">
      {detail.kind === "trade" ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {[
            {
              from: detail.fromState?.pseudo ?? detail.fromName,
              to: detail.toState?.pseudo ?? detail.toName,
              state: detail.fromState,
              items: detail.offeredCards ?? [],
              count: detail.offeredCount ?? 0,
              karas: detail.offeredKaras ?? 0
            },
            {
              from: detail.toState?.pseudo ?? detail.toName,
              to: detail.fromState?.pseudo ?? detail.fromName,
              state: detail.toState,
              items: detail.requestedCards ?? [],
              count: detail.requestedCount ?? 0,
              karas: detail.requestedKaras ?? 0
            }
          ].map((side, index) => (
            <section
              key={index}
              className="min-w-0 rounded-xl border border-slate-700/70 p-3"
            >
              <h4 className="text-sm font-bold text-cyan-100">
                {t("direction", {
                  from: side.from ?? t("deletedPlayer"),
                  to: side.to ?? t("deletedPlayer")
                })}
              </h4>
              <AccountStatus
                state={
                  side.state
                    ? { ...side.state, sanctionApplied: false }
                    : undefined
                }
              />
              <p className="mt-2 text-sm font-bold text-amber-100">
                {t("karas", { count: side.karas })}
              </p>
              {cards(side.items, side.count)}
            </section>
          ))}
        </div>
      ) : (
        <section className="min-w-0 rounded-xl border border-slate-700/70 p-3">
          <p className="text-sm font-bold text-amber-100">
            {t("eventAmount", { count: detail.amount ?? 0 })}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("startingPrice", { count: detail.startingPrice ?? 0 })}
          </p>
          {cards(detail.cards ?? [], 1)}
        </section>
      )}
      <p className="text-xs leading-relaxed text-slate-400">
        {t(detail.source === "captured" ? "captured" : "retained")}
      </p>
    </div>
  );
}
