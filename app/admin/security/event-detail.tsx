import { getTranslations } from "next-intl/server";

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
              from: detail.fromName,
              to: detail.toName,
              items: detail.offeredCards ?? [],
              count: detail.offeredCount ?? 0,
              karas: detail.offeredKaras ?? 0
            },
            {
              from: detail.toName,
              to: detail.fromName,
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
