import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { needsPostgres17 } from "../scripts/ci-sql-changes.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8"
);

test("SQL filter includes migrations, scripts and SQL tests, excludes application-only changes", () => {
  for (const path of [
    "supabase/migrations/x.sql",
    "scripts/replay-migrations.mjs",
    "scripts/admin/enable-pg-cron.sh",
    "tests/auction-cron-db.test.mjs",
    "tests/postgres17-auction-concurrency.mjs",
    "tests/migration-security.test.mjs",
    "tests/security-definer-allowlist.mjs",
    "tests/drop-rates-statistical.test.mjs",
    "tests/fixtures/example.sql",
    "tests/postgres17-collection-order.mjs",
    "lib/ui/collection-sort.ts",
    "lib/ui/collection-filter.ts"
  ])
    assert.equal(needsPostgres17([path]), true, path);
  assert.equal(
    needsPostgres17([
      "components/yokai-card.tsx",
      "styles/cards.css",
      "tests/card-image-performance.test.mjs",
      "docs/card-grid-sharpness.md"
    ]),
    false
  );
});

test("filter CLI uses the whole PR diff, includes deleted SQL tests, always enables master and fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "yokkai-ci-filter-"));
  const run = args =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  try {
    run(["init", "-q"]);
    run(["config", "user.name", "Disposable test"]);
    run(["config", "user.email", "test@example.invalid"]);
    writeFileSync(join(dir, "readme.md"), "base");
    run(["add", "."]);
    run(["commit", "-qm", "base"]);
    const base = run(["rev-parse", "HEAD"]);
    const script = fileURLToPath(
      new URL("../scripts/ci-sql-changes.mjs", import.meta.url)
    );
    const output = join(dir, "output");
    const check = (event, sha, extra = {}) =>
      spawnSync(process.execPath, [script], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: event,
          BASE_SHA: base,
          HEAD_SHA: sha,
          GITHUB_OUTPUT: output,
          ...extra
        }
      });
    writeFileSync(join(dir, "readme.md"), "front only");
    run(["add", "."]);
    run(["commit", "-qm", "front"]);
    let head = run(["rev-parse", "HEAD"]);
    assert.equal(check("pull_request", head).status, 0);
    assert.match(readFileSync(output, "utf8"), /sql=false/);
    assert.equal(check("push", head).status, 0);
    assert.match(readFileSync(output, "utf8"), /sql=true/);
    assert.notEqual(
      check("pull_request", head, { BASE_SHA: "invalid" }).status,
      0
    );
    assert.notEqual(check("pull_request", "1".repeat(40)).status, 0);
    run(["reset", "--hard", base]);
    run(["clean", "-fd"]);
    run(["checkout", "-b", "sql"]);
    execFileSync(
      process.execPath,
      [
        "-e",
        "require('fs').mkdirSync('tests'); require('fs').writeFileSync('tests/example-db.test.mjs','// sql')"
      ],
      { cwd: dir }
    );
    run(["add", "."]);
    run(["commit", "-qm", "SQL test"]);
    head = run(["rev-parse", "HEAD"]);
    assert.equal(check("pull_request", head).status, 0);
    assert.match(readFileSync(output, "utf8"), /sql=true/);
    const sqlBase = head;
    run(["rm", "tests/example-db.test.mjs"]);
    run(["commit", "-qm", "delete SQL test"]);
    head = run(["rev-parse", "HEAD"]);
    assert.equal(check("pull_request", head, { BASE_SHA: sqlBase }).status, 0);
    assert.match(readFileSync(output, "utf8"), /sql=true/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflow preserves cancellation, npm cache and all checks; SQL job is conditional and Next cache persisted", () => {
  assert.match(workflow, /on:\s*\n\s+push:\s*\n\s+branches:\s*\n\s+- master/);
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s*\n\s+- master/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /concurrency:[\s\S]*?github\.event\.pull_request\.number \|\| github\.ref[\s\S]*?cancel-in-progress: true/
  );
  assert.equal((workflow.match(/cache: npm/g) ?? []).length, 4);
  const sql = workflow
    .split("  postgres17-auction-concurrency:")[1]
    .split("  migration-security:")[0];
  assert.match(sql, /needs: checks/);
  assert.match(
    sql,
    /!cancelled\(\).*github\.event_name == 'push'.*needs\.checks\.outputs\.sql == 'true'/
  );
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /node scripts\/ci-sql-changes\.mjs/);
  assert.match(workflow, /path: \.next\/cache/);
  assert.match(workflow, /restore-keys:/);
  for (const check of [
    "npm run lint",
    "npx tsc --noEmit",
    "npm run format:check",
    "npm test",
    "npm run build",
    "node tests/design-system-production.mjs"
  ])
    assert.ok(workflow.includes(check), check);
});

test("SQL tests with new names are detected from their source, including the old version of deleted tests", () => {
  for (const source of [
    'import { replayMigrations } from "../scripts/replay-migrations.mjs"',
    'import { PGlite } from "@electric-sql/pglite"',
    "const seed = bootstrapSQL"
  ])
    assert.equal(
      needsPostgres17(["tests/unusual-name.test.mjs"], () => source),
      true
    );
  assert.equal(
    needsPostgres17(["tests/client.test.mjs"], () => "test UI without SQL"),
    false
  );
});
