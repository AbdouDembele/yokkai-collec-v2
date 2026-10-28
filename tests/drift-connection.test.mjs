import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("an invalid replay selection is a failed check, not a divergence", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../scripts/compare-schema-catalog.mjs", import.meta.url)
      ),
      "unused"
    ],
    {
      env: { ...process.env, DRIFT_MIGRATIONS_JSON: "invalid-json" },
      encoding: "utf8"
    }
  );
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Catalogue comparison impossible/);
  assert.doesNotMatch(result.stdout, /divergences/);
});

test("drift distinguishes interrupted SSH, unavailable comparison and actual divergence", t => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "yokkai-drift-connection-")
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "scripts"));
  mkdirSync(path.join(directory, "bin"));
  cpSync(
    new URL("../scripts/check-prod-drift.sh", import.meta.url),
    path.join(directory, "scripts/check-prod-drift.sh")
  );
  writeFileSync(
    path.join(directory, "scripts/schema-catalog.sql"),
    "select 1;\n"
  );
  writeFileSync(
    path.join(directory, "bin/ssh"),
    '#!/usr/bin/env bash\ncat >/dev/null\nif [[ "$MOCK_SSH_STATUS" != 0 ]]; then echo "Connection reset by peer" >&2; exit "$MOCK_SSH_STATUS"; fi\necho catalogue\n',
    { mode: 0o755 }
  );
  writeFileSync(
    path.join(directory, "bin/node"),
    '#!/usr/bin/env bash\ntouch comparison-called\nexit "$MOCK_COMPARE_STATUS"\n',
    { mode: 0o755 }
  );
  const bash =
    process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  for (const [sshStatus, compareStatus, expected, message] of [
    [255, 0, 3, /connection interrupted/],
    [1, 0, 2, /catalogue extraction failed/],
    [0, 2, 2, /comparison failed/],
    [0, 1, 1, /divergence detected/],
    [0, 0, 0, null]
  ]) {
    rmSync(path.join(directory, "comparison-called"), { force: true });
    const result = spawnSync(
      bash,
      ["-c", 'export PATH="$PWD/bin:$PATH"; bash scripts/check-prod-drift.sh'],
      {
        cwd: directory,
        env: {
          ...process.env,
          PROD_SSH_ALIAS: "fixture",
          MOCK_SSH_STATUS: String(sshStatus),
          MOCK_COMPARE_STATUS: String(compareStatus)
        },
        encoding: "utf8",
        timeout: 10000
      }
    );
    assert.equal(result.status, expected, result.stderr);
    if (message) assert.match(result.stderr, message);
    assert.equal(
      existsSync(path.join(directory, "comparison-called")),
      sshStatus === 0
    );
    if (expected > 1) assert.doesNotMatch(result.stderr, /divergence detected/);
  }
});
