import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("local CI audits first and stops at the first failing command", () => {
  const directory = mkdtempSync(join(tmpdir(), "kara-ci-"));
  const log = join(directory, "commands.jsonl");
  const npm = join(directory, "npm.mjs");
  try {
    writeFileSync(
      npm,
      `import { appendFileSync } from "node:fs";
appendFileSync(process.env.CI_TEST_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
process.exit(process.argv[2] === "audit" ? 0 : 17);
`
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/ci.mjs", import.meta.url))],
      {
        env: { ...process.env, npm_execpath: npm, CI_TEST_LOG: log },
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line)),
      [
        ["audit", "--omit=dev", "--audit-level=high"],
        ["run", "lint"]
      ]
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
