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

// Dashboard layout: KPI tiles + alerts, 24 h trend + hourly status bars,
// services table, then the raw details. Server-rendered only: no hover is
// required to read any value (every chart also has a text equivalent).

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
const strokeStyles: Record<MonitorLevel, string> = {
  0: "stroke-cyan-300",
  1: "stroke-amber-300",
  2: "stroke-rose-400"
};
const badgeStyles: Record<MonitorLevel, string> = {
  0: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30",
  1: "bg-amber-400/15 text-amber-200 ring-amber-300/30",
  2: "bg-rose-500/20 text-rose-200 ring-rose-300/40"
};
const levelKeys = ["ok", "warning", "critical"] as const;

const cardClass =
  "min-w-0 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 shadow-[0_0_24px_rgba(34,211,238,0.04)] sm:p-5";

/** One point every 5 minutes: 12 points is one hour. */
const POINTS_PER_HOUR = 12;

type Pair = [number, number];

/** Splits a series on missing values so gaps are not drawn as lines. */
function segments(
  values: (number | null)[],
  x: (index: number) => number,
  y: (value: number) => number
) {
  const result: Pair[][] = [];
  let current: Pair[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) result.push(current);
      current = [];
    } else current.push([x(index), y(value)]);
  });
  if (current.length) result.push(current);
  return result;
}

/** Catmull-Rom curve through the points, clamped to the chart height. */
function smoothPath(points: Pair[], height: number) {
  if (points.length === 0) return "";
  const clamp = (value: number) => Math.min(height, Math.max(0, value));
  let path = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6);
    path += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return path;
}

function StatusPill({ level }: { level: MonitorLevel }) {
  const t = useTranslations("adminMonitoring");
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border sm:self-auto px-2.5 py-1 text-xs font-bold ${levelStyles[level]}`}
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${dotStyles[level]}`}
      />
      {t(`levels.${levelKeys[level]}`)}
    </span>
  );
}

function StatusBadge({ level }: { level: MonitorLevel }) {
  const t = useTranslations("adminMonitoring");
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[0.7rem] font-black uppercase tracking-wider ring-1 ${badgeStyles[level]}`}
    >
      {t(`levels.${levelKeys[level]}`)}
    </span>
  );
}

function MiniSparkline({
  values,
  level
}: {
  values: (number | null)[];
  level: MonitorLevel;
}) {
  const known = values.filter((value): value is number => value !== null);
  if (known.length < 2) return null;
  const width = 120;
  const height = 44;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const step = width / Math.max(1, values.length - 1);
  const lines = segments(
    values,
    index => index * step,
    value => height - 4 - ((value - min) / span) * (height - 8)
  );
  return (
    <svg
      aria-hidden="true"
      className="h-11 w-24 shrink-0 sm:w-28"
      preserveAspectRatio="none"
      viewBox={`0 0 ${width} ${height}`}
    >
      {lines.map((line, index) => (
        <path
          className={strokeStyles[level]}
          d={smoothPath(line, height)}
          fill="none"
          key={index}
          strokeLinecap="round"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function KpiTile({
  label,
  value,
  values,
  level,
  delta,
  higherIsBetter = false
}: {
  label: string;
  value: string;
  values: (number | null)[];
  level: MonitorLevel;
  delta: { raw: number; text: string } | null;
  higherIsBetter?: boolean;
}) {
  const t = useTranslations("adminMonitoring");
  const better =
    delta === null || Math.abs(delta.raw) < 0.005
      ? null
      : delta.raw > 0 === higherIsBetter;
  return (
    <article className={`${cardClass} flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-black tabular-nums sm:text-3xl">
            {value}
          </p>
          <h3 className="mt-0.5 text-sm text-slate-400">{label}</h3>
        </div>
        <MiniSparkline level={level} values={values} />
      </div>
      <p className="flex items-center gap-2 text-xs font-semibold">
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ring-4 ${
            better === null
              ? "bg-slate-400 ring-slate-400/15"
              : better
                ? "bg-emerald-400 ring-emerald-400/15"
                : "bg-rose-400 ring-rose-400/15"
          }`}
        />
        <span
          className={
            better === null
              ? "text-slate-400"
              : better
                ? "text-emerald-300"
                : "text-rose-300"
          }
        >
          {delta === null
            ? t("noTrend")
            : t("deltaValue", { delta: delta.text })}
        </span>
      </p>
    </article>
  );
}

function AxisLabels({ hours }: { hours: number[] }) {
  const t = useTranslations("adminMonitoring");
  return (
    <div
      aria-hidden="true"
      className="mt-2 flex justify-between text-[0.7rem] text-slate-500 tabular-nums"
    >
      {hours.map((hour, index) => (
        <span
          className={
            index % 2 === 1 && hours.length > 3 ? "hidden sm:inline" : ""
          }
          key={hour}
        >
          {hour === 0 ? t("axisNow") : t("axisHoursAgo", { hours: hour })}
        </span>
      ))}
    </div>
  );
}

type Series = {
  key: string;
  label: string;
  color: string;
  fill: string;
  values: (number | null)[];
};

function TrendChart({
  series,
  threshold,
  formatValue
}: {
  series: Series[];
  threshold: number;
  formatValue: (value: number) => string;
}) {
  const t = useTranslations("adminMonitoring");
  const length = Math.max(0, ...series.map(item => item.values.length));
  const known = series.flatMap(item =>
    item.values.filter((value): value is number => value !== null)
  );
  if (length < 2 || known.length < 2)
    return <p className="mt-4 text-sm text-slate-400">{t("noTrend")}</p>;

  const width = 600;
  const height = 240;
  const peakValue = Math.max(threshold, ...known);
  const tickStep = peakValue <= 1 ? 0.25 : peakValue <= 2 ? 0.5 : 1;
  const max = Math.ceil(peakValue / tickStep) * tickStep || 1;
  const step = width / (length - 1);
  const x = (index: number) => index * step;
  const y = (value: number) => height - (value / max) * height;
  const ticks = Array.from(
    { length: Math.round(max / tickStep) + 1 },
    (_, index) => index * tickStep
  );

  // Callout on the highest value of the first series, like a hovered point.
  const main = series[0].values;
  let peakIndex = -1;
  main.forEach((value, index) => {
    if (value !== null && (peakIndex < 0 || value > (main[peakIndex] ?? 0)))
      peakIndex = index;
  });
  const peak = peakIndex >= 0 ? main[peakIndex] : null;
  const peakLeft = (peakIndex / (length - 1)) * 100;
  const hoursAgo = Math.round((length - 1 - peakIndex) / POINTS_PER_HOUR);

  return (
    <div className="mt-4 flex gap-2">
      <div
        aria-hidden="true"
        className="relative h-52 w-9 shrink-0 text-right sm:h-64 text-[0.7rem] text-slate-500 tabular-nums"
      >
        {ticks.map(tick => (
          <span
            className="absolute right-0 -translate-y-1/2"
            key={tick}
            style={{ top: `${(1 - tick / max) * 100}%` }}
          >
            {formatValue(tick)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-52 sm:h-64">
          <svg
            aria-hidden="true"
            className="absolute inset-0 size-full overflow-visible"
            preserveAspectRatio="none"
            viewBox={`0 0 ${width} ${height}`}
          >
            <defs>
              {series.map(item => (
                <linearGradient
                  id={`trend-${item.key}`}
                  key={item.key}
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={item.fill} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={item.fill} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map(tick => (
              <line
                className="stroke-slate-700/60"
                key={tick}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                x1="0"
                x2={width}
                y1={y(tick)}
                y2={y(tick)}
              />
            ))}
            {peakIndex >= 0 && (
              <rect
                className="fill-cyan-300/[0.06]"
                height={height}
                width={Math.max(step * 6, 12)}
                x={x(peakIndex) - Math.max(step * 3, 6)}
                y="0"
              />
            )}
            <line
              className="stroke-amber-400/60"
              strokeDasharray="5 5"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              x1="0"
              x2={width}
              y1={y(threshold)}
              y2={y(threshold)}
            />
            {series.map(item =>
              segments(item.values, x, y).map((line, index) => {
                const d = smoothPath(line, height);
                const first = line[0];
                const last = line.at(-1) ?? first;
                return (
                  <g key={`${item.key}-${index}`}>
                    <path
                      d={`${d} L${last[0]},${height} L${first[0]},${height} Z`}
                      fill={`url(#trend-${item.key})`}
                    />
                    <path
                      className={item.color}
                      d={d}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })
            )}
          </svg>
          {peak !== null && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${peakLeft}%`,
                top: `${(1 - peak / max) * 100}%`
              }}
            >
              <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.7)]" />
              <span
                className={`absolute top-3 whitespace-nowrap rounded-lg border border-cyan-300/30 bg-slate-950/95 px-2.5 py-1.5 text-xs shadow-lg ${
                  peakLeft > 70
                    ? "right-0"
                    : peakLeft < 30
                      ? "left-0"
                      : "-translate-x-1/2"
                }`}
              >
                <span className="block font-bold text-slate-100">
                  {t("peak", { value: formatValue(peak) })}
                </span>
                <span className="block text-slate-400">
                  {hoursAgo === 0
                    ? t("axisNow")
                    : t("axisHoursAgo", { hours: hoursAgo })}
                </span>
              </span>
            </div>
          )}
        </div>
        <AxisLabels hours={[24, 18, 12, 6, 0]} />
      </div>
    </div>
  );
}

type HourBucket = { ok: number; warning: number; critical: number };

function hourlyBuckets(history: MonitorPoint[]) {
  const buckets: HourBucket[] = Array.from({ length: 24 }, () => ({
    ok: 0,
    warning: 0,
    critical: 0
  }));
  const last = Date.parse(history.at(-1)?.at ?? "");
  if (!Number.isFinite(last)) return buckets;
  for (const point of history) {
    const at = Date.parse(point.at);
    if (!Number.isFinite(at)) continue;
    const ago = Math.floor((last - at) / 3_600_000);
    if (ago < 0 || ago > 23) continue;
    const bucket = buckets[23 - ago];
    bucket[levelKeys[point.worst]] += 1;
  }
  return buckets;
}

function StatusBars({ history }: { history: MonitorPoint[] }) {
  const t = useTranslations("adminMonitoring");
  const format = useFormatter();
  const buckets = hourlyBuckets(history);
  const totals = buckets.reduce(
    (sum, bucket) => ({
      ok: sum.ok + bucket.ok,
      all: sum.all + bucket.ok + bucket.warning + bucket.critical
    }),
    { ok: 0, all: 0 }
  );
  const share = totals.all ? totals.ok / totals.all : null;
  return (
    <>
      <p className="mt-1 text-sm text-slate-400">
        {share === null
          ? t("noTrend")
          : t("healthyShare", {
              percent: format.number(share, {
                style: "percent",
                maximumFractionDigits: 1
              })
            })}
      </p>
      <ol className="mt-4 flex h-44 items-stretch justify-between gap-[3px] sm:h-52 sm:gap-1">
        {buckets.map((bucket, index) => {
          const total = bucket.ok + bucket.warning + bucket.critical;
          const hours = 23 - index;
          return (
            <li
              className="flex min-w-0 max-w-3 flex-1 flex-col-reverse overflow-hidden rounded-full bg-slate-800/70"
              key={hours}
            >
              <span className="sr-only">
                {t("hourBar", {
                  hours,
                  ok: bucket.ok,
                  warning: bucket.warning,
                  critical: bucket.critical
                })}
              </span>
              {total > 0 &&
                (["ok", "warning", "critical"] as const).map(key =>
                  bucket[key] ? (
                    <span
                      aria-hidden="true"
                      className={
                        key === "ok"
                          ? "bg-cyan-400/80"
                          : key === "warning"
                            ? "bg-amber-400"
                            : "bg-rose-500"
                      }
                      key={key}
                      style={{ height: `${(bucket[key] / total) * 100}%` }}
                    />
                  ) : null
                )}
            </li>
          );
        })}
      </ol>
      <AxisLabels hours={[24, 12, 0]} />
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        {(
          [
            ["bg-cyan-400/80", "ok"],
            ["bg-amber-400", "warning"],
            ["bg-rose-500", "critical"]
          ] as const
        ).map(([color, key]) => (
          <li className="flex items-center gap-1.5" key={key}>
            <span
              aria-hidden="true"
              className={`size-2.5 rounded-sm ${color}`}
            />
            {t(`levels.${key}`)}
          </li>
        ))}
      </ul>
    </>
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
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-black">{title}</h3>
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
  const overall: MonitorLevel = stale ? 2 : snapshot.worst;
  const { host, containers, db, backups, app, security } = snapshot;
  const issueLevel = (key: string): MonitorLevel =>
    snapshot.issues.find(issue => issue.key === key)?.level ?? 0;
  const memPct =
    host.memAvailable !== null && host.memTotal
      ? host.memAvailable / host.memTotal
      : null;
  const diskPct =
    host.diskFree !== null && host.diskTotal
      ? 1 - host.diskFree / host.diskTotal
      : null;
  const loadPerCpu =
    host.load5 !== null && host.cpus ? host.load5 / host.cpus : null;
  const connPct =
    db.connUsed !== null && db.connMax ? db.connUsed / db.connMax : null;

  const history = data.history;
  const pick = (key: keyof Omit<MonitorPoint, "at" | "worst">) =>
    history.map(point => point[key]);
  const recent = (values: (number | null)[]) =>
    values.slice(-POINTS_PER_HOUR * 6);
  const delta = (
    values: (number | null)[],
    style: "percent" | "decimal"
  ): { raw: number; text: string } | null => {
    const last = values.at(-1);
    const before = values.at(-1 - POINTS_PER_HOUR);
    if (last == null || before == null) return null;
    const raw = last - before;
    return {
      raw,
      text: format.number(raw, {
        style,
        signDisplay: "exceptZero",
        maximumFractionDigits: style === "percent" ? 0 : 2
      })
    };
  };

  const load = pick("loadPerCpu");
  const memory = pick("memAvailablePct");
  const connections = pick("connPct");
  const disk = pick("diskUsedPct");

  const http = (key: "site" | "api") =>
    snapshot.http.find(check => check.key === key);
  const services: {
    key: string;
    name: string;
    level: MonitorLevel;
    measure: string;
    detail: string;
  }[] = [
    ...(["site", "api"] as const).map(key => {
      const check = http(key);
      return {
        key,
        name: t(`http.${key}`),
        level: check?.level ?? levels.http,
        measure:
          check?.status == null
            ? (check?.error ?? t("unknown"))
            : t("httpStatus", { status: check.status }),
        detail:
          check?.ms == null
            ? t("unknown")
            : t("responseTime", { ms: n(check.ms) })
      };
    }),
    {
      key: "db",
      name: t("sections.db"),
      level: levels.db,
      measure:
        db.up === false
          ? t("dbDown")
          : t("connectionsValue", {
              used: n(db.connUsed),
              max: n(db.connMax)
            }),
      detail: db.longQueries
        ? t("longQueriesValue", {
            count: db.longQueries,
            seconds: n(db.longestSeconds)
          })
        : t("noLongQueries")
    },
    {
      key: "containers",
      name: t("sections.containers"),
      level: levels.containers,
      measure: t("runningValue", { count: containers.running ?? 0 }),
      detail:
        containers.missing.length > 0
          ? t("stoppedList", { names: containers.missing.join(", ") })
          : containers.unhealthy.length > 0
            ? t("unhealthyList", { names: containers.unhealthy.join(", ") })
            : t("allRunning")
    },
    {
      key: "backups",
      name: t("sections.backups"),
      level: levels.backups,
      measure:
        backups.ageHours === null
          ? t("noBackup")
          : t("hoursAgo", { hours: n(backups.ageHours) }),
      detail: backups.offsite ? t("backupOffsite") : t("backupLocal")
    },
    {
      key: "app",
      name: t("sections.app"),
      level: levels.app,
      measure: n(app.errors5m),
      detail: t("appErrors")
    },
    {
      key: "firewall",
      name: t("firewall"),
      level: issueLevel("sec.nft"),
      measure: security.firewall ? t("firewallActive") : t("firewallMissing"),
      detail: t("firewallDetail")
    },
    {
      key: "fail2ban",
      name: t("fail2ban"),
      level: issueLevel("sec.f2b"),
      measure:
        security.f2bBanned === null
          ? t("unknown")
          : t("fail2banValue", {
              banned: security.f2bBanned,
              total: n(security.f2bTotal)
            }),
      detail: t("fail2banDetail")
    }
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid gap-4 sm:gap-6 xl:grid-cols-12">
        <section
          aria-labelledby="monitoring-overview"
          className="min-w-0 xl:col-span-7"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black" id="monitoring-overview">
              {t("overviewTitle")}
            </h2>
            <span className="rounded-md bg-cyan-400/15 px-2 py-0.5 text-xs font-bold text-cyan-200 ring-1 ring-cyan-300/30">
              {t("runningValue", { count: containers.running ?? 0 })}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiTile
              delta={delta(load, "decimal")}
              label={t("charts.load")}
              level={issueLevel("host.load")}
              value={n(loadPerCpu, 2)}
              values={recent(load)}
            />
            <KpiTile
              delta={delta(memory, "percent")}
              higherIsBetter
              label={t("charts.memory")}
              level={issueLevel("host.mem")}
              value={pct(memPct)}
              values={recent(memory)}
            />
            <KpiTile
              delta={delta(connections, "percent")}
              label={t("charts.connections")}
              level={issueLevel("db.conn")}
              value={pct(connPct)}
              values={recent(connections)}
            />
            <KpiTile
              delta={delta(disk, "percent")}
              label={t("charts.disk")}
              level={issueLevel("host.disk")}
              value={pct(diskPct)}
              values={recent(disk)}
            />
          </div>
        </section>

        <section
          aria-labelledby="monitoring-alerts"
          className={`${cardClass} flex flex-col xl:col-span-5 xl:mt-10`}
        >
          <div
            className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${levelStyles[overall]}`}
            role="status"
          >
            <div className="min-w-0">
              <p className="font-black">
                {stale ? t("staleTitle") : t(`overall.${levelKeys[overall]}`)}
              </p>
              <p className="mt-1 text-sm opacity-80">
                {t("updated", {
                  time: format.relativeTime(new Date(snapshot.capturedAt), now)
                })}
                {stale ? ` ${t("staleHelp")}` : ""}
              </p>
            </div>
            <StatusPill level={overall} />
          </div>
          <h2
            className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-slate-400"
            id="monitoring-alerts"
          >
            {t("issuesTitle")}
          </h2>
          {snapshot.issues.length === 0 ? (
            <p className="mt-3 flex flex-1 items-center gap-2 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/15"
              />
              {t("noIssues")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2 xl:max-h-80 xl:overflow-y-auto xl:pr-1">
              {snapshot.issues.map(issue => (
                <li
                  className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm"
                  key={issue.key}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1 size-2.5 shrink-0 rounded-full ring-4 ${dotStyles[issue.level]} ${
                      issue.level === 2
                        ? "ring-rose-400/20"
                        : issue.level === 1
                          ? "ring-amber-400/20"
                          : "ring-emerald-400/20"
                    }`}
                  />
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="block font-semibold text-slate-100">
                      {t(`issues.${issue.code}`, {
                        subject: issue.subject ?? ""
                      })}
                    </span>
                    <span
                      className={`mt-0.5 block text-xs font-bold ${
                        issue.level === 2
                          ? "text-rose-300"
                          : issue.level === 1
                            ? "text-amber-300"
                            : "text-emerald-300"
                      }`}
                    >
                      {t(`levels.${levelKeys[issue.level]}`)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <section
          aria-labelledby="monitoring-trend"
          className={`${cardClass} lg:col-span-2`}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className="text-lg font-black" id="monitoring-trend">
              {t("trendTitle")}
            </h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-1 w-4 rounded-full bg-cyan-300"
                />
                {t("charts.load")}
              </li>
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-1 w-4 rounded-full bg-fuchsia-400"
                />
                {t("charts.connections")}
              </li>
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="w-4 border-t border-dashed border-amber-400"
                />
                {t("threshold")}
              </li>
            </ul>
          </div>
          <TrendChart
            formatValue={value =>
              format.number(value, {
                style: "percent",
                maximumFractionDigits: 0
              })
            }
            series={[
              {
                key: "load",
                label: t("charts.load"),
                color: "stroke-cyan-300",
                fill: "#67e8f9",
                values: load
              },
              {
                key: "connections",
                label: t("charts.connections"),
                color: "stroke-fuchsia-400",
                fill: "#e879f9",
                values: connections
              }
            ]}
            threshold={0.8}
          />
          <p className="mt-3 text-xs text-slate-500">{t("historyHelp")}</p>
        </section>

        <section aria-labelledby="monitoring-hours" className={cardClass}>
          <h2 className="text-lg font-black" id="monitoring-hours">
            {t("statusTitle")}
          </h2>
          <StatusBars history={history} />
        </section>
      </div>

      <section aria-labelledby="monitoring-services" className={cardClass}>
        <h2 className="text-lg font-black" id="monitoring-services">
          {t("servicesTitle")}
        </h2>
        <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr className="border-b border-slate-800">
                <th className="py-2 pr-4 font-semibold" scope="col">
                  {t("table.service")}
                </th>
                <th className="py-2 pr-4 font-semibold" scope="col">
                  {t("table.status")}
                </th>
                <th className="py-2 pr-4 font-semibold" scope="col">
                  {t("table.measure")}
                </th>
                <th className="py-2 font-semibold" scope="col">
                  {t("table.detail")}
                </th>
              </tr>
            </thead>
            <tbody>
              {services.map(service => (
                <tr
                  className="border-b border-slate-800/70 last:border-0"
                  key={service.key}
                >
                  <th
                    className="py-3 pr-4 font-semibold text-slate-100"
                    scope="row"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`size-2 shrink-0 rounded-full ${dotStyles[service.level]}`}
                      />
                      {service.name}
                    </span>
                  </th>
                  <td className="py-3 pr-4">
                    <StatusBadge level={service.level} />
                  </td>
                  <td className="py-3 pr-4 font-semibold text-cyan-200 tabular-nums">
                    {service.measure}
                  </td>
                  <td className="py-3 text-slate-400">{service.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="monitoring-details" className="space-y-3">
        <h2 className="text-lg font-black" id="monitoring-details">
          {t("detailsTitle")}
        </h2>
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

          <Section level={levels.containers} title={t("topCpu")}>
            {containers.top.length === 0 ? (
              <Row label={t("running")} value={n(containers.running)} />
            ) : (
              containers.top.map(item => {
                const share = Math.min(
                  100,
                  item.cpu / Math.max(1, host.cpus ?? 1)
                );
                return (
                  <div key={item.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="min-w-0 truncate text-slate-300">
                        {item.name}
                      </dt>
                      <dd className="shrink-0 font-semibold text-slate-100 tabular-nums">
                        {t("cpuValue", { value: n(item.cpu) })}
                        {item.mem ? ` · ${item.mem}` : ""}
                      </dd>
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800"
                    >
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </Section>

          <Section level={levels.db} title={t("sections.db")}>
            {db.up === false ? (
              <Row label={t("dbStatus")} value={t("dbDown")} />
            ) : (
              <>
                <Row label={t("slotLag")} value={size(db.slotLagMax)} />
                <Row
                  label={t("tempFiles")}
                  value={
                    db.tempBytes5m === null
                      ? t("unknown")
                      : size(db.tempBytes5m)
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
        </div>
      </section>
    </div>
  );
}

export type { MonitorSnapshot };
