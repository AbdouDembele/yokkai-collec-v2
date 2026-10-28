import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("deployment pins the same Node major as verification and explicit npm phases", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url))
  );
  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url))
  );
  assert.equal(pkg.engines?.node, "22.x");
  assert.deepEqual(lock.packages[""].engines, pkg.engines);
  const config = JSON.parse(
    readFileSync(new URL("../railpack.json", import.meta.url), "utf8")
  );
  assert.equal(config.packages.node, "22");
  assert.deepEqual(config.steps.install.commands, ["npm ci --include=dev"]);
  assert.deepEqual(config.steps.build.commands, ["npm run build"]);
  assert.equal(pkg.scripts.build, "next build --webpack");
  assert.equal(config.deploy.startCommand, "npm run start");
});
