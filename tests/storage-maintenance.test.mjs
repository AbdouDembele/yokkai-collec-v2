import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("storage maintenance protects backups, deployed images and Docker volumes", () => {
  const result = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-m",
      "unittest",
      "discover",
      "-s",
      "ops",
      "-p",
      "test_storage_maintenance.py"
    ],
    { encoding: "utf8", timeout: 30000 }
  );
  assert.equal(
    result.status,
    0,
    result.error?.message || result.stderr || result.stdout
  );
});
