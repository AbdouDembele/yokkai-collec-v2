// Parses the admin_get_ops_monitor() payload written by ops/monitor/yokkai-monitor.
// Everything is defensive: the snapshot comes from a host script, so missing
// or malformed values degrade to "unknown" instead of breaking the page.

export type MonitorLevel = 0 | 1 | 2;

export type MonitorIssue = {
  key: string;
  level: MonitorLevel;
  /** Translation key under adminMonitoring.issues. */
  code: string;
  /** Container label, slot or cron job carried by the key, if any. */
  subject: string | null;
};

export type MonitorHttpCheck = {
  key: "site" | "api";
  status: number | null;
  ms: number | null;
  error: string | null;
  level: MonitorLevel;
};

export type MonitorSnapshot = {
  capturedAt: string;
  worst: MonitorLevel;
  host: {
    load1: number | null;
    load5: number | null;
    load15: number | null;
    cpus: number | null;
    memTotal: number | null;
    memAvailable: number | null;
    swapTotal: number | null;
    swapUsed: number | null;
    diskTotal: number | null;
    diskFree: number | null;
  };
  containers: {
    running: number | null;
    missing: string[];
    unhealthy: string[];
    top: { name: string; cpu: number; mem: string }[];
  };
  http: MonitorHttpCheck[];
  db: {
    up: boolean | null;
    connUsed: number | null;
    connMax: number | null;
    longQueries: number | null;
    longestSeconds: number | null;
    slotLagMax: number | null;
    slotName: string | null;
    tempBytes5m: number | null;
    sizeBytes: number | null;
    cronFailed: { job: string; count: number }[];
    usersTotal: number | null;
    usersActive24h: number | null;
  };
  backups: { ageHours: number | null; offsite: boolean };
  app: { errors5m: number | null };
  security: {
    f2bBanned: number | null;
    f2bTotal: number | null;
    firewall: boolean | null;
  };
  issues: MonitorIssue[];
};

export type MonitorPoint = {
  at: string;
  worst: MonitorLevel;
  loadPerCpu: number | null;
  memAvailablePct: number | null;
  diskUsedPct: number | null;
  connPct: number | null;
};

export type MonitorData = {
  /** Database clock when the data was read (keeps rendering pure). */
  now: number;
  latest: MonitorSnapshot | null;
  history: MonitorPoint[];
};

const averageOf = (values: (number | null)[]) => {
  const known = values.filter((value): value is number => value !== null);
  return known.length
    ? known.reduce((sum, value) => sum + value, 0) / known.length
    : null;
};

/**
 * Averages consecutive points into at most maxPoints buckets (the monitor
 * writes one point per minute; charts do not need 1 440 points). Each bucket
 * keeps the time of its last point and its worst level.
 */
export function downsampleHistory(
  history: MonitorPoint[],
  maxPoints: number
): MonitorPoint[] {
  const size = Math.ceil(history.length / Math.max(1, maxPoints));
  if (size <= 1) return history;
  const result: MonitorPoint[] = [];
  for (let start = 0; start < history.length; start += size) {
    const bucket = history.slice(start, start + size);
    const last = bucket[bucket.length - 1];
    result.push({
      at: last.at,
      worst: bucket.reduce(
        (worst, point) => (point.worst > worst ? point.worst : worst),
        0 as MonitorLevel
      ),
      loadPerCpu: averageOf(bucket.map(point => point.loadPerCpu)),
      memAvailablePct: averageOf(bucket.map(point => point.memAvailablePct)),
      diskUsedPct: averageOf(bucket.map(point => point.diskUsedPct)),
      connPct: averageOf(bucket.map(point => point.connPct))
    });
  }
  return result;
}

/** A snapshot older than this is considered stale (monitor stopped). */
export const STALE_AFTER_MS = 15 * 60 * 1000;

type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, 120) : null;

const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const level = (value: unknown): MonitorLevel =>
  value === 2 ? 2 : value === 1 ? 1 : 0;

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map(str)
        .filter((item): item is string => item !== null)
        .slice(0, 30)
    : [];

const ratio = (part: number | null, total: number | null) =>
  part !== null && total ? part / total : null;

// Issue keys emitted by the monitor. Prefixed keys carry a subject after the
// prefix (container label, replication slot or cron job name).
const exactIssues: Record<string, string> = {
  "host.load": "hostLoad",
  "host.mem": "hostMemory",
  "host.disk": "hostDisk",
  "host.inodes": "hostInodes",
  docker: "dockerDown",
  "http.site": "siteDown",
  "http.api": "apiDown",
  "http.site.slow": "siteSlow",
  "http.api.slow": "apiSlow",
  "db.down": "dbDown",
  "db.conn": "dbConnections",
  "db.long": "dbLongQueries",
  "db.slotlag": "dbSlotLag",
  "db.temp": "dbTempFiles",
  "db.query": "dbMetricsUnavailable",
  "backup.none": "backupMissing",
  "backup.age": "backupOld",
  "app.errors": "appErrors",
  "sec.f2b": "fail2banDown",
  "sec.nft": "firewallMissing"
};

const prefixedIssues: [string, string][] = [
  ["ctr.down.", "containerDown"],
  ["ctr.unhealthy.", "containerUnhealthy"],
  ["ctr.oom.", "containerOom"],
  ["db.slot.inactive.", "dbSlotInactive"],
  ["db.cron.", "cronFailed"],
  ["monitor.", "checkFailed"]
];

export function describeIssue(key: string, issueLevel: MonitorLevel) {
  const exact = exactIssues[key];
  if (exact) return { key, level: issueLevel, code: exact, subject: null };
  for (const [prefix, code] of prefixedIssues)
    if (key.startsWith(prefix))
      return {
        key,
        level: issueLevel,
        code,
        subject: key.slice(prefix.length).slice(0, 80) || null
      };
  return { key, level: issueLevel, code: "unknown", subject: key.slice(0, 80) };
}

export function parseSnapshot(value: unknown): MonitorSnapshot | null {
  const row = record(value);
  const capturedAt = str(row.capturedAt);
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) return null;
  const payload = record(row.payload);
  const host = record(payload.host);
  const containers = record(payload.containers);
  const db = record(payload.db);
  const backups = record(payload.backups);
  const app = record(payload.app);
  const security = record(payload.security);
  const http = (Array.isArray(payload.http) ? payload.http : [])
    .map(record)
    .filter(item => item.key === "site" || item.key === "api")
    .map(item => ({
      key: item.key as "site" | "api",
      status: num(item.status),
      ms: num(item.ms),
      error: str(item.error),
      level: level(item.level)
    }));
  const issues = (Array.isArray(payload.issues) ? payload.issues : [])
    .map(record)
    .map(item => ({ key: str(item.key), level: level(item.level) }))
    .filter((item): item is { key: string; level: MonitorLevel } =>
      Boolean(item.key)
    )
    .slice(0, 50)
    .map(item => describeIssue(item.key, item.level));
  return {
    capturedAt,
    worst: level(row.worst),
    host: {
      load1: num(host.load1),
      load5: num(host.load5),
      load15: num(host.load15),
      cpus: num(host.cpus),
      memTotal: num(host.memTotal),
      memAvailable: num(host.memAvailable),
      swapTotal: num(host.swapTotal),
      swapUsed: num(host.swapUsed),
      diskTotal: num(host.diskTotal),
      diskFree: num(host.diskFree)
    },
    containers: {
      running: num(containers.running),
      missing: strings(containers.missing),
      unhealthy: strings(containers.unhealthy),
      top: (Array.isArray(containers.top) ? containers.top : [])
        .map(record)
        .map(item => ({
          name: str(item.name) ?? "?",
          cpu: num(item.cpu) ?? 0,
          mem: str(item.mem) ?? ""
        }))
        .slice(0, 5)
    },
    http,
    db: {
      up: bool(db.up),
      connUsed: num(db.connUsed),
      connMax: num(db.connMax),
      longQueries: num(db.longQueries),
      longestSeconds: num(db.longestSeconds),
      slotLagMax: num(db.slotLagMax),
      slotName: str(db.slotName),
      tempBytes5m: num(db.tempBytes5m),
      sizeBytes: num(db.sizeBytes),
      cronFailed: (Array.isArray(db.cronFailed) ? db.cronFailed : [])
        .map(record)
        .map(item => ({
          job: str(item.job) ?? "?",
          count: num(item.count) ?? 0
        }))
        .slice(0, 20),
      usersTotal: num(db.usersTotal),
      usersActive24h: num(db.usersActive24h)
    },
    backups: {
      ageHours: num(backups.ageHours),
      offsite: backups.offsite === true
    },
    app: { errors5m: num(app.errors5m) },
    security: {
      f2bBanned: num(security.f2bBanned),
      f2bTotal: num(security.f2bTotal),
      firewall: bool(security.firewall)
    },
    issues
  };
}

export function parseMonitorData(value: unknown): MonitorData {
  const data = record(value);
  const history = (Array.isArray(data.history) ? data.history : [])
    .map(record)
    .filter(point => typeof point.at === "string")
    .slice(-2016)
    .map(point => {
      const memTotal = num(point.memTotal);
      const diskTotal = num(point.diskTotal);
      const diskFree = num(point.diskFree);
      const cpus = num(point.cpus);
      return {
        at: point.at as string,
        worst: level(point.worst),
        loadPerCpu: ratio(num(point.load5), cpus),
        memAvailablePct: ratio(num(point.memAvailable), memTotal),
        diskUsedPct:
          diskTotal && diskFree !== null ? 1 - diskFree / diskTotal : null,
        connPct: ratio(num(point.connUsed), num(point.connMax))
      };
    });
  const now = typeof data.now === "string" ? Date.parse(data.now) : Number.NaN;
  const latest = parseSnapshot(data.latest);
  return {
    now: Number.isFinite(now)
      ? now
      : latest
        ? Date.parse(latest.capturedAt)
        : 0,
    latest,
    history
  };
}

/** Section levels, derived from the active issues of the snapshot. */
export function sectionLevels(snapshot: MonitorSnapshot) {
  const sections = {
    host: 0,
    containers: 0,
    http: 0,
    db: 0,
    backups: 0,
    app: 0,
    security: 0
  } as Record<
    "host" | "containers" | "http" | "db" | "backups" | "app" | "security",
    MonitorLevel
  >;
  const sectionOf = (key: string) =>
    key.startsWith("host.")
      ? "host"
      : key === "docker" || key.startsWith("ctr.")
        ? "containers"
        : key.startsWith("http.")
          ? "http"
          : key.startsWith("db.")
            ? "db"
            : key.startsWith("backup.")
              ? "backups"
              : key.startsWith("app.")
                ? "app"
                : key.startsWith("sec.")
                  ? "security"
                  : null;
  for (const issue of snapshot.issues) {
    const section = sectionOf(issue.key);
    if (section && issue.level > sections[section])
      sections[section] = issue.level;
  }
  return sections;
}

export function isStale(snapshot: MonitorSnapshot, now: number) {
  return now - Date.parse(snapshot.capturedAt) > STALE_AFTER_MS;
}
