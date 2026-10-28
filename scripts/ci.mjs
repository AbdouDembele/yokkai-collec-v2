import { spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Launch with npm run ci or npm run verify");
const quick = process.argv.includes("--quick");
const files = execFileSync("git", ["ls-files", "-z", "tests"], {
  encoding: "utf8"
})
  .split("\0")
  .filter(file => file.endsWith(".test.mjs"));
const unit = files.filter(
  file =>
    !file.endsWith("-db.test.mjs") &&
    !/replayMigrations|bootstrapSQL|@electric-sql\/pglite/.test(
      readFileSync(file, "utf8")
    )
);
const tests = quick
  ? unit
  : files.filter(file => file !== "tests/migration-security.test.mjs");
const steps = [
  ...(!quick
    ? [["Audit prod", [npm, "audit", "--omit=dev", "--audit-level=high"]]]
    : []),
  ["Lint", [npm, "run", "lint"]],
  ["TypeScript", [require.resolve("typescript/bin/tsc"), "--noEmit"]],
  ["Format", [npm, "run", "format:check"]],
  [
    quick
      ? `Tests unitaires (${tests.length} fichiers)`
      : `Tests complets (${tests.length} fichiers)`,
    ["--test", "--test-concurrency=4", ...tests]
  ],
  ...(!quick
    ? [
        [
          process.platform === "win32"
            ? "Build production (Webpack Windows)"
            : "Build production",
          [
            require.resolve("next/dist/bin/next"),
            "build",
            ...(process.platform === "win32" ? ["--webpack"] : [])
          ]
        ],
        [
          "Design-system interdit en production",
          ["tests/design-system-production.mjs"]
        ],
        [
          "Migrations vierges + SECURITY DEFINER + unicité",
          ["--test", "tests/migration-security.test.mjs"]
        ]
      ]
    : [])
];
// Never build against a production session or a real public project key.
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ci_dummy",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_ci_dummy",
  NEXT_PUBLIC_SITE_URL: "https://example.invalid",
  MAINTENANCE_MODE: "false"
};
const summary = [];
for (const [label, args] of steps) {
  const start = Date.now();
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    windowsHide: true,
    env
  });
  const ok = !result.error && result.status === 0;
  summary.push(
    `${ok ? "OK" : "ECHEC"} ${label} (${((Date.now() - start) / 1000).toFixed(1)} s)`
  );
  if (!ok) {
    process.exitCode = result.status || 1;
    break;
  }
}
console.log("\n--- Résumé des contrôles locaux ---\n" + summary.join("\n"));
