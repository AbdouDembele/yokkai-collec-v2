import { getTranslations } from "next-intl/server";
import { AdminNavigation } from "@/app/admin/admin-navigation";
import { MonitoringView } from "@/app/admin/monitoring/monitoring-view";
import { parseMonitorData } from "@/lib/admin/monitoring";

// Development-only preview (the proxy returns 404 for /design-system in
// production). ?state=ok|warning|critical|stale|empty selects a fixture.
const capturedAt = "2026-11-03T20:15:00.000Z";
const at = Date.parse(capturedAt);
const GiB = 1024 ** 3;

function fixture(state: string) {
  const warning = state === "warning" || state === "critical";
  const critical = state === "critical";
  const history = Array.from({ length: 288 }, (_, index) => {
    const wave = Math.sin(index / 18) * 0.5 + Math.sin(index / 5) * 0.15;
    return {
      at: new Date(at - (287 - index) * 300_000).toISOString(),
      // Make the hourly status bars show a few degraded snapshots.
      worst: critical && index > 276 ? 2 : warning && wave > 0.45 ? 1 : 0,
      load5: Math.max(0.5, 8 + wave * 6),
      cpus: 8,
      memTotal: 15 * GiB,
      memAvailable: (5 + wave * 2) * GiB,
      diskTotal: 251 * GiB,
      diskFree: (135 - index * 0.01) * GiB,
      connUsed: Math.round(50 + wave * 15),
      connMax: 100
    };
  });
  const issues = [
    ...(warning ? [{ key: "host.load", level: critical ? 2 : 1 }] : []),
    ...(warning ? [{ key: "db.temp", level: 1 }] : []),
    ...(critical
      ? [
          { key: "ctr.down.supabase-storage", level: 2 },
          { key: "db.slot.inactive.cainophile_0mknvqyl", level: 1 }
        ]
      : [])
  ];
  return {
    latest:
      state === "empty"
        ? null
        : {
            capturedAt,
            worst: critical ? 2 : warning ? 1 : 0,
            payload: {
              v: 1,
              host: {
                load1: warning ? 13.3 : 3.1,
                load5: warning ? 11.6 : 2.8,
                load15: warning ? 13.4 : 2.5,
                cpus: 8,
                memTotal: 15 * GiB,
                memAvailable: 5.1 * GiB,
                swapTotal: 0,
                swapUsed: 0,
                diskTotal: 251 * GiB,
                diskFree: 135 * GiB,
                inodesPct: 8
              },
              containers: {
                running: critical ? 21 : 22,
                missing: critical ? ["supabase-storage"] : [],
                unhealthy: [],
                top: [
                  { name: "coolify", cpu: 190, mem: "1.2GiB" },
                  { name: "supabase-db", cpu: 143, mem: "3.4GiB" },
                  { name: "supabase-rustfs", cpu: 98, mem: "612MiB" }
                ]
              },
              http: [
                { key: "site", status: 200, ms: 142, error: null, level: 0 },
                { key: "api", status: 200, ms: 87, error: null, level: 0 }
              ],
              db: {
                up: true,
                connUsed: 52,
                connMax: 100,
                longQueries: warning ? 2 : 0,
                longestSeconds: warning ? 74 : 0,
                slotLagMax: 485 * 1024 ** 2,
                slotName: "cainophile_0mknvqyl",
                inactiveSlots: [],
                tempBytes5m: warning ? 24 * GiB : 0.4 * GiB,
                sizeBytes: 515 * 1024 ** 2,
                cronFailed: [],
                usersTotal: 514,
                usersActive24h: 49
              },
              backups: { ageHours: 19.2, offsite: false },
              app: { errors5m: warning ? 31 : 2 },
              security: { f2bBanned: 13, f2bTotal: 559, firewall: true },
              issues
            }
          },
    history
  };
}

export default async function MonitoringPreviewPage({
  searchParams
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state = "warning" } = await searchParams;
  const t = await getTranslations("adminMonitoring");
  const data = parseMonitorData(fixture(state));
  const now = at + (state === "stale" ? 40 : 2) * 60_000;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="min-w-0 px-3 py-6 [overflow-wrap:anywhere] sm:px-8 sm:py-8">
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
          <MonitoringView data={data} now={now} />
        </div>
      </main>
    </div>
  );
}
