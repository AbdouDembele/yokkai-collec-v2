import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const atLeast = (version, minimum) => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const parts = version.split(".").map(Number);
  for (let index = 0; index < minimum.length; index++) {
    if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
  }
  return true;
};

test("Next and its image dependency retain the security fixes without weakening the production audit", () => {
  const pkg = read("package.json");
  const lock = read("package-lock.json");
  // GHSA-2464-fhr4-w9xw and GHSA-p3m5-59mp-jv5r: patched in Next 16.4.1.
  assert.ok(atLeast(pkg.dependencies.next, [16, 4, 1]));
  assert.equal(
    pkg.devDependencies["eslint-config-next"],
    pkg.dependencies.next
  );
  for (const name of ["next", "eslint-config-next"]) {
    assert.equal(
      lock.packages[`node_modules/${name}`].version,
      pkg.dependencies.next
    );
  }
  assert.ok(atLeast(lock.packages["node_modules/sharp"].version, [0, 35, 5]));
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8"
  );
  assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
});
