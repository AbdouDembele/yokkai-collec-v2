import type { Metadata } from "next";
import { UrlPagination } from "@/components/ui/url-pagination";
import Link from "next/link";
import { cookies } from "next/headers";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { requireAdminPage } from "@/lib/auth/admin";
import { getCurrentKarasBalance, getCurrentPseudo } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";
import { AdminNavigation } from "../admin-navigation";
import { playerDetailFromRpc } from "../players/player-data";
import { ReportList, type AdminReport } from "./report-list";
import { ReportedPlayerModal } from "./reported-player-modal";
import { CardReportList, type AdminCardReport } from "./card-report-list";

export const metadata: Metadata = { title: "Admin · Reports" };

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
const allowedStatuses = new Set(["pending", "reviewed", "dismissed"]);

function reportFromRpc(value: Record<string, unknown>): AdminReport {
  const rawSnapshot = value.snapshot;
  const snapshot =
    typeof rawSnapshot === "object" && rawSnapshot !== null
      ? (rawSnapshot as Record<string, unknown>)
      : {};
  return {
    id: String(value.id ?? ""),
    reporterId: String(value.reporterId ?? ""),
    reporterPseudo: String(value.reporterPseudo ?? "Deleted player"),
    reporterEmail: String(value.reporterEmail ?? ""),
    reportedId: String(value.reportedId ?? ""),
    reportedPseudo: String(value.reportedPseudo ?? "Deleted player"),
    reportedEmail: String(value.reportedEmail ?? ""),
    reportedIsBanned: value.reportedIsBanned === true,
    reason: String(value.reason) as AdminReport["reason"],
    contextType: String(value.contextType) as AdminReport["contextType"],
    contextId: typeof value.contextId === "string" ? value.contextId : null,
    snapshot: {
      message:
        typeof snapshot.message === "string" ? snapshot.message : undefined,
      gifUrl: typeof snapshot.gifUrl === "string" ? snapshot.gifUrl : null,
      hasMedia: snapshot.hasMedia === true,
      author:
        typeof snapshot.author === "object" && snapshot.author !== null
          ? (snapshot.author as { id?: string; pseudo?: string })
          : undefined,
      createdAt:
        typeof snapshot.createdAt === "string" ? snapshot.createdAt : undefined,
      postId: typeof snapshot.postId === "string" ? snapshot.postId : undefined
    },
    details: String(value.details ?? ""),
    status: String(value.status) as AdminReport["status"],
    createdAt: String(value.createdAt ?? "")
  };
}

function cardReportFromRpc(value: Record<string, unknown>): AdminCardReport {
  return {
    id: String(value.id ?? ""),
    reporterId: String(value.reporterId ?? ""),
    reporterPseudo: String(value.reporterPseudo ?? "Deleted player"),
    reporterEmail: String(value.reporterEmail ?? ""),
    cardId: String(value.cardId ?? ""),
    cardName: String(value.cardName ?? "Card"),
    franchise: String(value.franchise ?? ""),
    imageUrl: String(value.imageUrl ?? ""),
    rarity: String(value.rarity ?? ""),
    reason: String(value.reason) as AdminCardReport["reason"],
    status: String(value.status) as AdminCardReport["status"],
    createdAt: String(value.createdAt ?? "")
  };
}

export default async function AdminReportsPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    player?: string;
  }>;
}) {
  const admin = await requireAdminPage();
  const client = createClient(await cookies());
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 100) ?? "";
  const status = allowedStatuses.has(params.status ?? "") ? params.status! : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const playerId = /^[0-9a-f-]{36}$/i.test(params.player ?? "")
    ? params.player!
    : null;
  const [name, karas, result, cardResult, detailResult] = await Promise.all([
    getCurrentPseudo(admin.id),
    getCurrentKarasBalance(client),
    client.rpc("admin_search_reports", {
      p_status: status || null,
      p_query: query,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE
    }),
    client.rpc("admin_search_card_reports", {
      p_status: status || null,
      p_query: query,
      p_limit: 100,
      p_offset: 0
    }),
    playerId
      ? client.rpc("admin_get_player", { p_user_id: playerId })
      : Promise.resolve({ data: null, error: null })
  ]);
  if (result.error) throw new Error(result.error.message);
  if (cardResult.error) throw new Error(cardResult.error.message);
  if (detailResult.error) throw new Error(detailResult.error.message);
  const payload = (result.data ?? {}) as Record<string, unknown>;
  const reports = (Array.isArray(payload.reports) ? payload.reports : []).map(
    item => reportFromRpc(item as Record<string, unknown>)
  );
  const total = Number(payload.total ?? 0);
  const cardPayload = (cardResult.data ?? {}) as Record<string, unknown>;
  const cardReports = (
    Array.isArray(cardPayload.reports) ? cardPayload.reports : []
  ).map(item => cardReportFromRpc(item as Record<string, unknown>));
  const cardTotal = Number(cardPayload.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const baseParams = {
    ...(query ? { q: query } : {}),
    ...(status ? { status } : {}),
    page: String(page)
  };
  const closeHref = `/admin/reports?${new URLSearchParams(baseParams)}`;
  const playerHrefBase = `/admin/reports?${new URLSearchParams(baseParams)}&player=`;
  const selectedPlayer = playerDetailFromRpc(
    detailResult.data as Record<string, unknown> | null
  );
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Topbar
        view="admin"
        account={<AccountMenu />}
        name={name ?? undefined}
        karas={karas}
      />
      <main id="main-content" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-7xl space-y-8">
          <header>
            <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">
              Administration
            </p>
            <h1 className="text-3xl font-black">Reports</h1>
            <p className="mt-1 text-sm text-slate-400">
              Review and categorize cards and players reported by the community.
            </p>
          </header>
          <AdminNavigation />
          <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5">
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto_auto]"
              method="get"
            >
              <input
                aria-label="Search reports"
                className="yk-field-control"
                defaultValue={query}
                maxLength={100}
                name="q"
                placeholder="Card, license, username or email address…"
              />
              <select
                aria-label="Report status"
                className="yk-field-control"
                defaultValue={status}
                name="status"
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="reviewed">Reviewed</option>
                <option value="dismissed">Dismissed</option>
              </select>
              <button className="yk-button" type="submit">
                Filter
              </button>
              {(query || status) && (
                <Link
                  className="yk-button yk-button-secondary"
                  href="/admin/reports"
                >
                  Clear
                </Link>
              )}
            </form>
            <p className="mt-3 text-xs text-slate-500">
              {total + cardTotal} report{total + cardTotal === 1 ? "" : "s"}{" "}
              found
            </p>
          </section>
          <div>
            <h2 className="mb-4 text-xl font-black">
              Reported cards{" "}
              <span className="text-sm font-normal text-slate-500">
                ({cardTotal})
              </span>
            </h2>
            <CardReportList
              reports={cardReports}
              playerHrefBase={playerHrefBase}
            />
          </div>
          <div id="admin-reports-list" tabIndex={0}>
            <h2 className="mb-4 text-xl font-black">
              Reported players{" "}
              <span className="text-sm font-normal text-slate-500">
                ({total})
              </span>
            </h2>
            <ReportList reports={reports} playerHrefBase={playerHrefBase} />
          </div>
          <UrlPagination
            page={page}
            pageCount={pages}
            scrollTargetId="admin-reports-list"
          />
        </div>
      </main>
      <ReportedPlayerModal player={selectedPlayer} closeHref={closeHref} />
    </div>
  );
}
