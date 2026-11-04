import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = path =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadMonitoringLib() {
  const { outputText } = ts.transpileModule(read("lib/admin/monitoring.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const cjs = { exports: {} };
  vm.runInNewContext(outputText, { module: cjs, exports: cjs.exports });
  return cjs.exports;
}

const lib = loadMonitoringLib();
const en = JSON.parse(read("messages/en.json"));
const fr = JSON.parse(read("messages/fr.json"));

test("snapshot parsing is defensive and maps issue keys to translated codes", () => {
  assert.equal(lib.parseSnapshot(null), null);
  assert.equal(lib.parseSnapshot({ capturedAt: "not a date" }), null);
  const snapshot = lib.parseSnapshot({
    capturedAt: "2026-11-03T20:15:00Z",
    worst: 2,
    payload: {
      host: { load5: 11.5, cpus: "8" },
      http: [
        { key: "site", status: 200, ms: 120, level: 0 },
        { key: "evil", status: 500 }
      ],
      issues: [
        { key: "ctr.down.supabase-storage", level: 2 },
        { key: "host.load", level: 1 },
        { key: "something.new", level: 1 },
        { level: 2 }
      ]
    }
  });
  assert.equal(snapshot.worst, 2);
  assert.equal(snapshot.host.load5, 11.5);
  assert.equal(snapshot.host.cpus, null, "strings are not numbers");
  assert.deepEqual(
    snapshot.http.map(check => check.key),
    ["site"]
  );
  assert.deepEqual(
    snapshot.issues.map(issue => [issue.code, issue.subject]),
    [
      ["containerDown", "supabase-storage"],
      ["hostLoad", null],
      ["unknown", "something.new"]
    ]
  );
  const levels = lib.sectionLevels(snapshot);
  assert.equal(levels.containers, 2);
  assert.equal(levels.host, 1);
  assert.equal(levels.db, 0);
});

test("history points are converted to ratios and staleness follows 15 minutes", () => {
  const data = lib.parseMonitorData({
    latest: { capturedAt: "2026-11-03T20:00:00Z", worst: 0, payload: {} },
    history: [
      {
        at: "2026-11-03T20:00:00Z",
        load5: 4,
        cpus: 8,
        memAvailable: 25,
        memTotal: 100,
        diskTotal: 200,
        diskFree: 50,
        connUsed: 30,
        connMax: 100
      }
    ]
  });
  const [point] = data.history;
  assert.equal(point.loadPerCpu, 0.5);
  assert.equal(point.memAvailablePct, 0.25);
  assert.equal(point.diskUsedPct, 0.75);
  assert.equal(point.connPct, 0.3);
  const captured = Date.parse("2026-11-03T20:00:00Z");
  assert.equal(lib.isStale(data.latest, captured + 14 * 60_000), false);
  assert.equal(lib.isStale(data.latest, captured + 16 * 60_000), true);
});

test("minute history is averaged into buckets for the charts", () => {
  const point = (minute, load, worst = 0) => ({
    at: new Date(Date.UTC(2026, 10, 4, 12, minute)).toISOString(),
    worst,
    loadPerCpu: load,
    memAvailablePct: null,
    diskUsedPct: 0.5,
    connPct: 0.4
  });
  const history = [
    point(0, 1),
    point(1, 3, 1),
    point(2, null),
    point(3, 2),
    point(4, 4)
  ];
  assert.equal(lib.downsampleHistory(history, 10), history);
  const buckets = lib.downsampleHistory(history, 2);
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].at, history[2].at, "bucket keeps its last time");
  assert.equal(buckets[0].loadPerCpu, 2, "missing values are skipped");
  assert.equal(buckets[0].worst, 1, "bucket keeps its worst level");
  assert.equal(buckets[0].memAvailablePct, null);
  assert.equal(buckets[1].loadPerCpu, 3);
});

test("every issue code and monitoring label exists in English and French", () => {
  const monitor = read("ops/monitor/yokkai-monitor");
  // Placeholders become concrete subjects: {key} is "site" or "api".
  const emitted = [...monitor.matchAll(/issues\.append\(\(f?"([^"]+)"/g)]
    .map(match => match[1])
    .flatMap(raw =>
      raw.includes("{key}")
        ? ["site", "api"].map(key => raw.replace("{key}", key))
        : [raw]
    )
    .map(raw => raw.replace(/\{[^}]*\}/g, "x"));
  assert.ok(emitted.length > 15, "monitor issue keys found");
  for (const key of emitted) {
    const { code } = lib.describeIssue(key, 1);
    assert.notEqual(code, "unknown", `unmapped monitor issue ${key}`);
    assert.equal(typeof en.adminMonitoring.issues[code], "string", code);
    assert.equal(typeof fr.adminMonitoring.issues[code], "string", code);
  }
  const keys = value =>
    Object.entries(value).flatMap(([key, child]) =>
      typeof child === "object"
        ? keys(child).map(sub => `${key}.${sub}`)
        : [key]
    );
  assert.deepEqual(keys(fr.adminMonitoring), keys(en.adminMonitoring));
  assert.equal(en.adminNavigation.monitoring, "Monitoring");
  assert.equal(typeof fr.adminNavigation.monitoring, "string");
});

test("the monitoring page is admin-only and linked from the admin navigation", () => {
  const page = read("app/admin/monitoring/page.tsx");
  assert.match(read("app/admin/admin-navigation.tsx"), /\/admin\/monitoring/);
  assert.ok(
    page.indexOf("requireAdminPage()") < page.indexOf("admin_get_ops_monitor"),
    "admin check before reading snapshots"
  );
  assert.match(page, /force-dynamic/);
  const monitor = read("ops/monitor/yokkai-monitor");
  assert.match(monitor, /ops_monitor_snapshots/);
  assert.doesNotMatch(monitor, /discord(app)?\.com\/api\/webhooks\/\d/);
});
