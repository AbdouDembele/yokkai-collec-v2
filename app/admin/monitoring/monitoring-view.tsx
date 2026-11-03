import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  isStale,
  sectionLevels,
  type MonitorData,
  type MonitorLevel,
  type MonitorPoint,
  type MonitorSnapshot
} from "@/lib/admin/monitoring";

const levelStyles: Record<MonitorLevel, string> = {
  0: "border-emerald-300/30 bg-emerald-500/10 text-emerald-100",
  1: "border-amber-300/30 bg-amber-500/10 text-amber-100",
  2: "border-rose-300/40 bg-rose-500/15 text-rose-100"
};
const dotStyles: Record<MonitorLevel, string> = {
  0: "bg-emerald-400",
  1: "bg-amber-400",
  2: "bg-rose-400"
};
const levelKeys = ["ok", "warning", "critical"] as const;

function StatusPill({ level }: { level: MonitorLevel }) {
  const t = useTranslations("adminMonitoring");
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-xs font-bold sm:self-auto ${levelStyles[level]}`}
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${dotStyles[level]}`}
      />
      {t(`levels.${levelKeys[level]}`)}
    </span>
  );
}

function Section({
  title,
  level,
  children
}: {
  title: string;
  level: MonitorLevel;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black">{title}</h2>
        <StatusPill level={level} />
      </div>
      <dl className="mt-3 space-y-2 text-sm">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-semibold text-slate-100 [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function Sparkline({
  label,
  points,
  pick,
  threshold,
  current
}: {
  label: string;
  points: MonitorPoint[];
  pick: (point: MonitorPoint) => number | null;
  threshold?: number;
  current: string;
}) {
  const values = points.map(pick);
  const known = values.filter((value): value is number => value !== null);
  const max = Math.max(1, threshold ?? 0, ...known);
  const width = 300;
  const height = 64;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const y = (value: number) => height - (value / max) * (height - 4) - 2;
  const path = values
    .map((value, index) =>
      value === null ? null : `${index * step},${y(value).toFixed(1)}`
    )
    .filter(Boolean)
    .join(" ");
  return (
    <figure className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/65 p-3">
      <figcaption className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="font-bold text-slate-100">{current}</span>
      </figcaption>
      <svg
        aria-label={`${label} : ${current}`}
        className="mt-2 h-16 w-full"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {threshold !== undefined && (
          <line
            className="stroke-amber-400/50"
            strokeDasharray="4 4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            x1="0"
            x2={width}
            y1={y(threshold)}
            y2={y(threshold)}
          />
        )}
        {known.length > 1 && (
          <polyline
            className="stroke-cyan-300"
            fill="none"
            points={path}
            strokeLinejoin="round"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </figure>
  );
}

const gib = (bytes: number | null) =>
  bytes === null ? null : bytes / 1024 ** 3;

export function MonitoringView({
  data,
  now
}: {
  data: MonitorData;
  now: number;
}) {
  const t = useTranslations("adminMonitoring");
  const format = useFormatter();
  const snapshot = data.latest;
  const n = (value: number | null, digits = 0) =>
    value === null
      ? t("unknown")
      : format.number(value, { maximumFractionDigits: digits });
  const pct = (value: number | null) =>
    value === null
      ? t("unknown")
      : format.number(value, { style: "percent", maximumFractionDigits: 0 });
  const size = (bytes: number | null) =>
    bytes === null ? t("unknown") : t("gigabytes", { value: n(gib(bytes), 1) });

  if (!snapshot)
    return (
      <p className="rounded-xl border border-sky-300/15 bg-sky-500/5 p-4 text-sm text-sky-100/80">
        {t("empty")}
      </p>
    );

  const levels = sectionLevels(snapshot);
  const stale = isStale(snapshot, now);
  const { host, containers, db, backups, app, security } = snapshot;
  const memPct =
    host.memAvailable !== null && host.memTotal
      ? host.memAvailable / host.memTotal
      : null;
  const diskPct =
    host.diskFree !== null && host.diskTotal
      ? 1 - host.diskFree / host.diskTotal
      : null;
  const latestPoint = data.history.at(-1);

  return (
    <div className="space-y-6">
      <section
        aria-label={t("overviewLabel")}
        className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 ${levelStyles[stale ? 2 : snapshot.worst]}`}
        role="status"
      >
        <div className="min-w-0">
          <p className="text-lg font-black">
            {stale
              ? t("staleTitle")
              : t(`overall.${levelKeys[snapshot.worst]}`)}
          </p>
          <p className="mt-1 text-sm opacity-80">
            {t("updated", {
              time: format.relativeTime(new Date(snapshot.capturedAt), now)
            })}
            {stale ? ` ${t("staleHelp")}` : ""}
          </p>
        </div>
        <StatusPill level={stale ? 2 : snapshot.worst} />
      </section>

      <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-5">
        <h2 className="text-lg font-black">{t("issuesTitle")}</h2>
        {snapshot.issues.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">{t("noIssues")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {snapshot.issues.map(issue => (
              <li
                className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${levelStyles[issue.level]}`}
                key={issue.key}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${dotStyles[issue.level]}`}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="sr-only">
                    {t(`levels.${levelKeys[issue.level]}`)} :{" "}
                  </span>
                  {t(`issues.${issue.code}`, {
                    subject: issue.subject ?? ""
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("historyTitle")} className="space-y-3">
        <h2 className="text-lg font-black">{t("historyTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Sparkline
            current={n(
              host.load5 !== null && host.cpus ? host.load5 / host.cpus : null,
              2
            )}
            label={t("charts.load")}
            pick={point => point.loadPerCpu}
            points={data.history}
            threshold={1}
          />
          <Sparkline
            current={pct(memPct)}
            label={t("charts.memory")}
            pick={point => point.memAvailablePct}
            points={data.history}
            threshold={0.15}
          />
          <Sparkline
            current={pct(diskPct)}
            label={t("charts.disk")}
            pick={point => point.diskUsedPct}
            points={data.history}
            threshold={0.8}
          />
          <Sparkline
            current={pct(latestPoint?.connPct ?? null)}
            label={t("charts.connections")}
            pick={point => point.connPct}
            points={data.history}
            threshold={0.8}
          />
        </div>
        <p className="text-xs text-slate-500">{t("historyHelp")}</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section level={levels.host} title={t("sections.host")}>
          <Row
            label={t("load")}
            value={t("loadValue", {
              l1: n(host.load1, 1),
              l5: n(host.load5, 1),
              l15: n(host.load15, 1),
              cpus: n(host.cpus)
            })}
          />
          <Row
            label={t("memory")}
            value={t("memoryValue", {
              available: size(host.memAvailable),
              total: size(host.memTotal),
              percent: pct(memPct)
            })}
          />
          <Row
            label={t("swap")}
            value={
              host.swapTotal
                ? t("swapValue", {
                    used: size(host.swapUsed),
                    total: size(host.swapTotal)
                  })
                : t("noSwap")
            }
          />
          <Row
            label={t("disk")}
            value={t("diskValue", {
              percent: pct(diskPct),
              free: size(host.diskFree)
            })}
          />
        </Section>

        <Section level={levels.containers} title={t("sections.containers")}>
          <Row label={t("running")} value={n(containers.running)} />
          {containers.missing.length > 0 && (
            <Row label={t("stopped")} value={containers.missing.join(", ")} />
          )}
          {containers.unhealthy.length > 0 && (
            <Row
              label={t("unhealthy")}
              value={containers.unhealthy.join(", ")}
            />
          )}
          {containers.top.length > 0 && (
            <div>
              <dt className="text-slate-400">{t("topCpu")}</dt>
              <dd className="mt-1">
                <ul className="space-y-1">
                  {containers.top.map(item => (
                    <li
                      className="flex items-baseline justify-between gap-3 rounded-lg bg-slate-950/65 px-2.5 py-1.5"
                      key={item.name}
                    >
                      <span className="min-w-0 truncate text-slate-200">
                        {item.name}
                      </span>
                      <span className="shrink-0 font-semibold text-slate-100">
                        {t("cpuValue", { value: n(item.cpu) })}
                        {item.mem ? ` · ${item.mem}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </Section>

        <Section level={levels.http} title={t("sections.http")}>
          {snapshot.http.map(check => (
            <Row
              key={check.key}
              label={t(`http.${check.key}`)}
              value={
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`size-2 rounded-full ${dotStyles[check.level]}`}
                  />
                  {check.status === null
                    ? (check.error ?? t("unknown"))
                    : t("httpValue", {
                        status: check.status,
                        ms: n(check.ms)
                      })}
                </span>
              }
            />
          ))}
        </Section>

        <Section level={levels.db} title={t("sections.db")}>
          {db.up === false ? (
            <Row label={t("dbStatus")} value={t("dbDown")} />
          ) : (
            <>
              <Row
                label={t("connections")}
                value={t("ratio", { used: n(db.connUsed), max: n(db.connMax) })}
              />
              <Row
                label={t("longQueries")}
                value={
                  db.longQueries
                    ? t("longQueriesValue", {
                        count: db.longQueries,
                        seconds: n(db.longestSeconds)
                      })
                    : n(db.longQueries)
                }
              />
              <Row label={t("slotLag")} value={size(db.slotLagMax)} />
              <Row
                label={t("tempFiles")}
                value={
                  db.tempBytes5m === null ? t("unknown") : size(db.tempBytes5m)
                }
              />
              <Row
                label={t("cronFailures")}
                value={
                  db.cronFailed.length === 0
                    ? n(0)
                    : db.cronFailed
                        .map(job => `${job.job} (${job.count})`)
                        .join(", ")
                }
              />
              <Row
                label={t("databaseSize")}
                value={
                  db.sizeBytes === null
                    ? t("unknown")
                    : t("megabytes", { value: n(db.sizeBytes / 1024 ** 2) })
                }
              />
              <Row
                label={t("accounts")}
                value={t("accountsValue", {
                  total: n(db.usersTotal),
                  active: n(db.usersActive24h)
                })}
              />
            </>
          )}
        </Section>

        <Section level={levels.backups} title={t("sections.backups")}>
          <Row
            label={t("lastBackup")}
            value={
              backups.ageHours === null
                ? t("noBackup")
                : t("hoursAgo", { hours: n(backups.ageHours) })
            }
          />
          <Row
            label={t("offsite")}
            value={backups.offsite ? t("yes") : t("localOnly")}
          />
        </Section>

        <Section level={levels.app} title={t("sections.app")}>
          <Row label={t("appErrors")} value={n(app.errors5m)} />
        </Section>

        <Section level={levels.security} title={t("sections.security")}>
          <Row
            label={t("fail2ban")}
            value={
              security.f2bBanned === null
                ? t("unknown")
                : t("fail2banValue", {
                    banned: security.f2bBanned,
                    total: n(security.f2bTotal)
                  })
            }
          />
          <Row
            label={t("firewall")}
            value={
              security.firewall ? t("firewallActive") : t("firewallMissing")
            }
          />
        </Section>
      </div>
    </div>
  );
}

export type { MonitorSnapshot };
