import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AccountStatus, type AccountState } from "./event-detail";

export type RelatedAccount = {
  userId: string;
  pseudo: string | null;
  email: string | null;
  accountState: AccountState;
  removed: boolean;
  archived: boolean;
  acceptedTrades: number;
  soldAuctions: number;
  availableTransfers: number;
  cardsToSubject: number;
  cardsFromSubject: number;
  karasToSubject: number;
  karasFromSubject: number;
  sharedNetwork: boolean;
  sharedBrowser: boolean;
};
export type RelatedAccountData = {
  subject: AccountState & { userId: string; removed: boolean };
  accounts: RelatedAccount[];
  total: number;
  relatedTotal: number;
  pageSize: number;
  counts: { active: number; banned: number; deleted: number };
};

export async function RelatedAccountPicker({
  subjectId,
  role,
  data,
  query,
  status,
  page,
  selected,
  activeId,
  targetLabel
}: {
  subjectId: string;
  role: "primary" | "smurf" | "";
  data: RelatedAccountData;
  query: string;
  status: string;
  page: number;
  selected: string[];
  activeId: string | null;
  targetLabel: string;
}) {
  const t = await getTranslations("adminSecurity.relatedAccounts");
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const base = new URLSearchParams({
    sanction: subjectId,
    role,
    ...(activeId ? { primary: activeId } : {}),
    ...(selected.length ? { mode: "deleted" } : {}),
    ...(query ? { linked_q: query } : {}),
    ...(status ? { linked_status: status } : {})
  });
  const sourceName = data.subject.pseudo ?? t("unknownSubject");
  const archiveRows = data.accounts.filter(a => a.removed);
  return (
    <section
      className="mt-5 min-w-0 space-y-4"
      aria-labelledby="related-accounts-title"
    >
      <div className="space-y-2">
        <h3 id="related-accounts-title" className="text-lg font-black">
          {t("title", { player: sourceName })}
        </h3>
        <p className="text-sm font-semibold text-cyan-100">{targetLabel}</p>
        <p className="max-w-4xl text-sm leading-relaxed text-slate-300">
          {t("help")}
        </p>
        <p className="text-xs text-slate-400">{t("counts", data.counts)}</p>
      </div>
      <form
        method="get"
        className="grid min-w-0 gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_auto]"
      >
        <input type="hidden" name="sanction" value={subjectId} />
        <input type="hidden" name="role" value={role} />
        {activeId && <input type="hidden" name="primary" value={activeId} />}
        {selected.length > 0 && (
          <input type="hidden" name="mode" value="deleted" />
        )}
        {selected.map(id => (
          <input key={id} type="hidden" name="source_account" value={id} />
        ))}
        <label className="grid min-w-0 gap-1 text-sm font-semibold">
          {t("searchLabel")}
          <input
            className="yk-field-control min-w-0"
            name="linked_q"
            maxLength={100}
            defaultValue={query}
            placeholder={t("searchPlaceholder")}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-semibold">
          {t("statusLabel")}
          <select
            className="yk-field-control min-w-0"
            name="linked_status"
            defaultValue={status}
          >
            {["", "active", "banned", "deleted", "archived"].map(value => (
              <option key={value} value={value}>
                {t(`filters.${value || "all"}`)}
              </option>
            ))}
          </select>
        </label>
        <button className="yk-button min-h-11 self-end" type="submit">
          {t("search")}
        </button>
      </form>
      {status === "archived" && (
        <p className="rounded-lg border border-amber-300/30 bg-amber-500/5 p-3 text-sm text-amber-100">
          {t("allArchivesNotice")}
        </p>
      )}
      {data.subject.deleted && !data.subject.removed && (
        <p className="rounded-lg border border-amber-300/30 p-3 text-sm text-amber-100">
          {t("deletionInProgress")}
        </p>
      )}
      <p className="text-sm text-slate-300">
        {t("results", { count: data.total })}
      </p>
      <form method="get" className="min-w-0 space-y-4">
        <input type="hidden" name="sanction" value={subjectId} />
        <input type="hidden" name="role" value="primary" />
        <input type="hidden" name="mode" value="deleted" />
        <input type="hidden" name="linked_q" value={query} />
        <input type="hidden" name="linked_status" value={status} />
        <input type="hidden" name="linked_page" value={page} />
        {selected
          .filter(id => !data.accounts.some(a => a.userId === id))
          .map(id => (
            <input key={id} type="hidden" name="source_account" value={id} />
          ))}
        <div className="grid max-h-[65dvh] min-w-0 gap-3 overflow-y-auto rounded-xl p-1 lg:grid-cols-2">
          {!data.accounts.length && (
            <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-300 lg:col-span-2">
              {t("empty")}
            </p>
          )}
          {data.accounts.map(account => {
            const processed =
              account.availableTransfers === 0 &&
              account.acceptedTrades + account.soldAuctions > 0;
            const canSelect =
              role === "primary" &&
              !data.subject.deleted &&
              account.removed &&
              account.archived &&
              !processed &&
              account.availableTransfers > 0;
            const canInspect =
              !account.removed &&
              !account.accountState.deleted &&
              account.acceptedTrades > 0 &&
              (!data.subject.deleted || data.subject.removed);
            const inspect = new URLSearchParams(base);
            inspect.set("primary", account.userId);
            inspect.set("mode", "active");
            inspect.set("linked_page", String(page));
            if (data.subject.removed) {
              inspect.set("sanction", account.userId);
              inspect.set("mode", "deleted");
              inspect.set("role", "primary");
              inspect.delete("primary");
              inspect.delete("linked_q");
              inspect.delete("linked_status");
              inspect.delete("linked_page");
              inspect.append("source_account", subjectId);
            }
            return (
              <article
                key={account.userId}
                data-related-account={account.userId}
                className={`min-w-0 space-y-3 rounded-xl border bg-slate-950/70 p-3 [overflow-wrap:anywhere] sm:p-4 ${activeId === account.userId ? "border-white ring-1 ring-white/70" : "border-slate-700"}`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  {account.removed && (
                    <label className="flex size-11 shrink-0 items-center justify-center">
                      <input
                        className="size-5"
                        type="checkbox"
                        name="source_account"
                        value={account.userId}
                        defaultChecked={selected.includes(account.userId)}
                        disabled={!canSelect}
                        aria-label={t("selectDeleted", {
                          player:
                            account.pseudo ??
                            t("unknownAccount", {
                              reference: account.userId.slice(-8)
                            })
                        })}
                      />
                    </label>
                  )}
                  <div className="min-w-0 space-y-1">
                    <h4 className="text-base font-black text-slate-100">
                      {account.pseudo ??
                        t("unknownAccount", {
                          reference: account.userId.slice(-8)
                        })}
                    </h4>
                    <p className="text-xs text-slate-400">
                      {account.email ?? t("emailUnavailable")}
                    </p>
                    <AccountStatus state={account.accountState} />
                    {!account.accountState.deleted &&
                      !account.accountState.banned && (
                        <span className="inline-block rounded-md border border-cyan-300/25 bg-cyan-400/5 px-2 py-1 text-xs font-bold text-cyan-100">
                          {t("active")}
                        </span>
                      )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-lg bg-slate-800 px-2 py-1.5 text-slate-100">
                    {t("acceptedTrades", { count: account.acceptedTrades })}
                  </span>
                  {account.soldAuctions > 0 && (
                    <span className="rounded-lg bg-slate-800 px-2 py-1.5 text-slate-100">
                      {t("soldAuctions", { count: account.soldAuctions })}
                    </span>
                  )}
                  <span
                    className={`rounded-lg px-2 py-1.5 ${account.sharedNetwork ? "bg-cyan-400/10 text-cyan-100" : "bg-slate-900 text-slate-400"}`}
                  >
                    {t(
                      account.sharedNetwork
                        ? "networkObserved"
                        : "networkNotObserved"
                    )}
                  </span>
                  <span
                    className={`rounded-lg px-2 py-1.5 ${account.sharedBrowser ? "bg-cyan-400/10 text-cyan-100" : "bg-slate-900 text-slate-400"}`}
                  >
                    {t(
                      account.sharedBrowser
                        ? "browserObserved"
                        : "browserNotObserved"
                    )}
                  </span>
                </div>
                <dl className="grid min-w-0 grid-cols-2 gap-3 border-t border-slate-800 pt-3 text-xs">
                  <div>
                    <dt className="text-slate-400">{t("cardsToSubject")}</dt>
                    <dd className="mt-1 text-base font-black text-emerald-200">
                      {account.cardsToSubject}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">{t("cardsFromSubject")}</dt>
                    <dd className="mt-1 text-base font-black text-rose-200">
                      {account.cardsFromSubject}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">{t("karasToSubject")}</dt>
                    <dd className="mt-1 font-bold text-emerald-200">
                      {t("karas", { count: account.karasToSubject })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">{t("karasFromSubject")}</dt>
                    <dd className="mt-1 font-bold text-rose-200">
                      {t("karas", { count: account.karasFromSubject })}
                    </dd>
                  </div>
                </dl>
                {canInspect ? (
                  <Link
                    className="yk-button min-h-11 w-full whitespace-normal text-center"
                    href={`/admin/security?${inspect}#sanction-preview`}
                  >
                    {t(
                      account.accountState.sanctionApplied
                        ? "viewSanction"
                        : "inspect"
                    )}
                  </Link>
                ) : (
                  <p
                    className={`text-xs leading-relaxed ${processed ? "text-red-200" : "text-slate-400"}`}
                  >
                    {t(
                      processed
                        ? "processed"
                        : canSelect
                          ? "selectForRecovery"
                          : account.removed && !account.archived
                            ? "archiveMissing"
                            : account.removed && role !== "primary"
                              ? "primaryRoleRequired"
                              : "contextOnly"
                    )}
                  </p>
                )}
              </article>
            );
          })}
        </div>
        {selected.length > 20 && (
          <p role="alert" className="text-sm font-bold text-red-200">
            {t("selectionLimit")}
          </p>
        )}
        {(archiveRows.length > 0 || selected.length > 0) &&
          role === "primary" &&
          !data.subject.deleted && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-xs leading-relaxed text-slate-400">
                {t("archiveSelectionHelp", { count: selected.length })}
              </p>
              <button
                className="yk-button min-h-11 shrink-0 whitespace-normal"
                type="submit"
                formAction="/admin/security#sanction-preview"
              >
                {t("previewDeleted")}
              </button>
            </div>
          )}
      </form>
      {pages > 1 && (
        <nav
          aria-label={t("pagination")}
          className="flex flex-wrap items-center justify-between gap-3 text-sm"
        >
          {page > 1 ? (
            <Link
              className="yk-button yk-button-secondary"
              href={`/admin/security?${new URLSearchParams([...base, ["linked_page", String(page - 1)], ...selected.map(id => ["source_account", id])])}`}
            >
              {t("previous")}
            </Link>
          ) : (
            <span />
          )}
          <span>{t("page", { page, pages })}</span>
          {page < pages && (
            <Link
              className="yk-button yk-button-secondary"
              href={`/admin/security?${new URLSearchParams([...base, ["linked_page", String(page + 1)], ...selected.map(id => ["source_account", id])])}`}
            >
              {t("next")}
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
