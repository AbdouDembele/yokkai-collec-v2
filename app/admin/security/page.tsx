import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { UrlPagination } from "@/components/ui/url-pagination";
import { requireAdminPage } from "@/lib/auth/admin";
import { getCurrentKarasBalance, getCurrentPseudo } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";
import { AdminNavigation } from "../admin-navigation";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
const severities = new Set(["watch", "elevated", "high", "critical"]);
const eventTypes = new Set([
  "account_registered",
  "trade_created",
  "trade_accepted",
  "trade_declined",
  "trade_cancelled",
  "auction_created",
  "auction_bid",
  "auction_sold",
  "auction_expired",
  "referral_rewarded"
]);

type CaseRow = {
  userId: string;
  pseudo: string;
  email: string;
  score: number;
  severity: string;
  eventCount: number;
  reasonCodes: string[];
  lastFlaggedAt: string;
  linkedAccounts: number;
};

type EventParty = { id: string; pseudo: string } | null;
type EventSubject = {
  userId: string;
  pseudo: string;
  riskPoints: number;
  reasonCodes: string[];
};
type EventRow = {
  id: number;
  occurredAt: string;
  type: string;
  subjectId: string | null;
  amount: number;
  cardCount: number;
  actor: EventParty;
  counterparty: EventParty;
  subjects: EventSubject[];
  metadata: Record<string, unknown>;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function caseFromRpc(value: Record<string, unknown>): CaseRow {
  return {
    userId: String(value.userId ?? ""),
    pseudo: String(value.pseudo ?? ""),
    email: String(value.email ?? ""),
    score: Number(value.score ?? 0),
    severity: String(value.severity ?? "watch"),
    eventCount: Number(value.eventCount ?? 0),
    reasonCodes: strings(value.reasonCodes),
    lastFlaggedAt: String(value.lastFlaggedAt ?? ""),
    linkedAccounts: Number(value.linkedAccounts ?? 0)
  };
}

function partyFromRpc(value: unknown): EventParty {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return { id: String(record.id ?? ""), pseudo: String(record.pseudo ?? "") };
}

function eventFromRpc(value: Record<string, unknown>): EventRow {
  return {
    id: Number(value.id ?? 0),
    occurredAt: String(value.occurredAt ?? ""),
    type: String(value.type ?? ""),
    subjectId: typeof value.subjectId === "string" ? value.subjectId : null,
    amount: Number(value.amount ?? 0),
    cardCount: Number(value.cardCount ?? 0),
    actor: partyFromRpc(value.actor),
    counterparty: partyFromRpc(value.counterparty),
    metadata:
      value.metadata && typeof value.metadata === "object"
        ? (value.metadata as Record<string, unknown>)
        : {},
    subjects: (Array.isArray(value.subjects) ? value.subjects : []).map(
      item => {
        const record = item as Record<string, unknown>;
        return {
          userId: String(record.userId ?? ""),
          pseudo: String(record.pseudo ?? ""),
          riskPoints: Number(record.riskPoints ?? 0),
          reasonCodes: strings(record.reasonCodes)
        };
      }
    )
  };
}

const reasonKeys: Record<string, string> = {
  ONE_WAY_TRADE_SOURCE: "oneWayTradeSource",
  ONE_WAY_TRADE_BENEFICIARY: "oneWayTradeBeneficiary",
  TRADE_VALUE_IMBALANCE: "tradeValueImbalance",
  LARGE_KARA_TRANSFER: "largeKaraTransfer",
  REPEATED_TRADE_PAIR: "repeatedTradePair",
  EXTREME_AUCTION_BID: "extremeAuctionBid",
  EXTREME_AUCTION_BID_COUNTERPARTY: "extremeAuctionBidCounterparty",
  REPEATED_AUCTION_PAIR: "repeatedAuctionPair",
  REPEATED_AUCTION_SETTLEMENT_PAIR: "repeatedAuctionSettlementPair",
  REFERRAL_REWARD_BURST: "referralRewardBurst",
  NEW_ACCOUNT_ECONOMIC_ACTIVITY: "newAccountEconomicActivity"
};

const eventKeys: Record<string, string> = {
  account_registered: "accountRegistered",
  trade_created: "tradeCreated",
  trade_accepted: "tradeAccepted",
  trade_declined: "tradeDeclined",
  trade_cancelled: "tradeCancelled",
  auction_created: "auctionCreated",
  auction_bid: "auctionBid",
  auction_sold: "auctionSold",
  auction_expired: "auctionExpired",
  referral_rewarded: "referralRewarded"
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSecurity");
  return { title: t("metadataTitle") };
}

export default async function AdminSecurityPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    severity?: string;
    event?: string;
    user?: string;
    page?: string;
  }>;
}) {
  const admin = await requireAdminPage();
  const client = createClient(await cookies());
  const t = await getTranslations("adminSecurity");
  const locale = await getLocale();
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 100) ?? "";
  const severity = severities.has(params.severity ?? "")
    ? params.severity!
    : "";
  const eventType = eventTypes.has(params.event ?? "") ? params.event! : "";
  const userId = /^[0-9a-f-]{36}$/i.test(params.user ?? "")
    ? params.user!
    : null;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const [name, karas, casesResult, eventsResult] = await Promise.all([
    getCurrentPseudo(admin.id),
    getCurrentKarasBalance(client),
    client.rpc("admin_list_anticheat_cases", {
      p_query: query,
      p_severity: severity,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE
    }),
    client.rpc("admin_list_anticheat_events", {
      p_user_id: userId,
      p_event_type: eventType,
      p_limit: 40,
      p_offset: 0
    })
  ]);
  if (casesResult.error) throw new Error(casesResult.error.message);
  if (eventsResult.error) throw new Error(eventsResult.error.message);
  const casePayload = (casesResult.data ?? {}) as Record<string, unknown>;
  const eventPayload = (eventsResult.data ?? {}) as Record<string, unknown>;
  const summary = (casePayload.summary ?? {}) as Record<string, unknown>;
  const cases = (Array.isArray(casePayload.cases) ? casePayload.cases : []).map(
    item => caseFromRpc(item as Record<string, unknown>)
  );
  const events = (
    Array.isArray(eventPayload.events) ? eventPayload.events : []
  ).map(item => eventFromRpc(item as Record<string, unknown>));
  const total = Number(casePayload.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const baseParams = new URLSearchParams({
    ...(query ? { q: query } : {}),
    ...(severity ? { severity } : {}),
    ...(eventType ? { event: eventType } : {}),
    ...(userId ? { user: userId } : {})
  });
  const allPlayersParams = new URLSearchParams({
    ...(query ? { q: query } : {}),
    ...(severity ? { severity } : {}),
    ...(eventType ? { event: eventType } : {})
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Topbar
        view="admin"
        account={<AccountMenu />}
        name={name ?? undefined}
        karas={karas}
      />
      <main id="main-content" className="px-3 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <header>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300 sm:text-sm">
              {t("eyebrow")}
            </p>
            <h1 className="mt-1 text-3xl font-black sm:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              {t("description")}
            </p>
          </header>
          <AdminNavigation />

          <section
            aria-label={t("summaryLabel")}
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            {[
              ["openCases", Number(summary.open ?? 0)],
              ["criticalCases", Number(summary.critical ?? 0)],
              ["events24h", Number(summary.events24h ?? 0)],
              ["signals24h", Number(summary.flagged24h ?? 0)]
            ].map(([key, value]) => (
              <article
                className="rounded-2xl border border-cyan-300/15 bg-slate-900/70 p-4 sm:p-5"
                key={String(key)}
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t(String(key))}
                </p>
                <p className="mt-2 text-2xl font-black text-cyan-100 sm:text-3xl">
                  {Number(value).toLocaleString(locale)}
                </p>
              </article>
            ))}
          </section>

          <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-5">
            <form
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_12rem_auto_auto]"
              method="get"
            >
              <input
                aria-label={t("searchLabel")}
                className="yk-field-control min-w-0 sm:col-span-2 xl:col-span-1"
                defaultValue={query}
                maxLength={100}
                name="q"
                placeholder={t("searchPlaceholder")}
              />
              <select
                aria-label={t("severityLabel")}
                className="yk-field-control min-w-0"
                defaultValue={severity}
                name="severity"
              >
                <option value="">{t("allSeverities")}</option>
                {["watch", "elevated", "high", "critical"].map(item => (
                  <option key={item} value={item}>
                    {t(`severities.${item}`)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("eventLabel")}
                className="yk-field-control min-w-0"
                defaultValue={eventType}
                name="event"
              >
                <option value="">{t("allEvents")}</option>
                {[...eventTypes].map(item => (
                  <option key={item} value={item}>
                    {t(`events.${eventKeys[item]}`)}
                  </option>
                ))}
              </select>
              <button className="yk-button" type="submit">
                {t("filter")}
              </button>
              {(query || severity || eventType || userId) && (
                <Link
                  className="yk-button yk-button-secondary text-center"
                  href="/admin/security"
                >
                  {t("clear")}
                </Link>
              )}
            </form>
          </section>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
            <section className="min-w-0" id="anticheat-cases" tabIndex={0}>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">{t("casesTitle")}</h2>
                  <p className="text-sm text-slate-400">{t("casesHelp")}</p>
                </div>
                <span className="text-sm text-slate-500">
                  {t("caseCount", { count: total })}
                </span>
              </div>
              <div className="space-y-3">
                {cases.length === 0 ? (
                  <p className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">
                    {t("noCases")}
                  </p>
                ) : (
                  cases.map(item => (
                    <article
                      className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-cyan-300/30 sm:p-5"
                      key={item.userId}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="min-w-0 text-lg font-black [overflow-wrap:anywhere]">
                              {item.pseudo}
                            </h3>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs font-bold ${
                                item.severity === "critical"
                                  ? "border-red-400/50 bg-red-500/15 text-red-200"
                                  : item.severity === "high"
                                    ? "border-orange-400/50 bg-orange-500/15 text-orange-200"
                                    : item.severity === "elevated"
                                      ? "border-amber-400/50 bg-amber-500/15 text-amber-100"
                                      : "border-sky-400/40 bg-sky-500/10 text-sky-200"
                              }`}
                            >
                              {t(`severities.${item.severity}`)}
                            </span>
                          </div>
                          <p className="text-sm text-slate-400 [overflow-wrap:anywhere]">
                            {item.email}
                          </p>
                        </div>
                        <div className="shrink-0 sm:text-right">
                          <p className="text-2xl font-black text-cyan-100">
                            {item.score}
                          </p>
                          <p className="text-xs text-slate-500">
                            {t("riskPoints")}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.reasonCodes.map(code => (
                          <span
                            className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300"
                            key={code}
                          >
                            {reasonKeys[code]
                              ? t(`reasons.${reasonKeys[code]}`)
                              : code}
                          </span>
                        ))}
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800 pt-4 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-slate-500">{t("eventsCount")}</dt>
                          <dd className="font-semibold">{item.eventCount}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">
                            {t("linkedAccounts")}
                          </dt>
                          <dd className="font-semibold">
                            {item.linkedAccounts}
                          </dd>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <dt className="text-slate-500">{t("lastSignal")}</dt>
                          <dd className="font-semibold">
                            {dateFormatter.format(new Date(item.lastFlaggedAt))}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          className="yk-button yk-button-secondary"
                          href={`/admin/players?player=${item.userId}`}
                        >
                          {t("openPlayer")}
                        </Link>
                        <Link
                          className="yk-button yk-button-secondary"
                          href={`/admin/security?${new URLSearchParams({ ...Object.fromEntries(baseParams), user: item.userId })}`}
                        >
                          {t("showEvents")}
                        </Link>
                      </div>
                    </article>
                  ))
                )}
              </div>
              <UrlPagination
                page={page}
                pageCount={pages}
                scrollTargetId="anticheat-cases"
              />
            </section>

            <aside className="min-w-0 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-5 xl:sticky xl:top-24">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">{t("eventsTitle")}</h2>
                  <p className="text-sm text-slate-400">{t("eventsHelp")}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-500">
                  {Number(eventPayload.total ?? 0)}
                </span>
              </div>
              {userId && (
                <Link
                  className="mt-3 inline-flex text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                  href={`/admin/security?${allPlayersParams}`}
                >
                  {t("removePlayerFilter")}
                </Link>
              )}
              <div className="mt-4 max-h-[48rem] space-y-3 overflow-y-auto pr-1">
                {events.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    {t("noEvents")}
                  </p>
                ) : (
                  events.map(event => {
                    const points = event.subjects.reduce(
                      (sum, subject) => sum + subject.riskPoints,
                      0
                    );
                    const eventReasons = [
                      ...new Set(
                        event.subjects.flatMap(subject => subject.reasonCodes)
                      )
                    ];
                    return (
                      <article
                        className="rounded-xl border border-slate-800 bg-slate-950/65 p-3"
                        key={event.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-bold text-slate-100">
                            {t(`events.${eventKeys[event.type]}`)}
                          </h3>
                          {points > 0 && (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-200">
                              +{points}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-slate-300 [overflow-wrap:anywhere]">
                          {[event.actor?.pseudo, event.counterparty?.pseudo]
                            .filter(Boolean)
                            .join(" → ")}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {dateFormatter.format(new Date(event.occurredAt))}
                          {event.cardCount > 0
                            ? ` · ${t("cards", { count: event.cardCount })}`
                            : ""}
                          {event.amount > 0
                            ? ` · ${t("karas", { count: event.amount })}`
                            : ""}
                        </p>
                        {eventReasons.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {eventReasons.map(code => (
                              <span
                                className="rounded-md bg-amber-500/10 px-1.5 py-1 text-[0.68rem] font-semibold text-amber-100"
                                key={code}
                              >
                                {reasonKeys[code]
                                  ? t(`reasons.${reasonKeys[code]}`)
                                  : code}
                              </span>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </aside>
          </div>

          <p className="rounded-xl border border-sky-300/15 bg-sky-500/5 p-4 text-sm text-sky-100/80">
            {t("observationNotice")}
          </p>
        </div>
      </main>
    </div>
  );
}
