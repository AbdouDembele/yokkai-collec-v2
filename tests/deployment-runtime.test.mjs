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

test("the GHCR image mirrors the Railpack runtime and never bakes server secrets", () => {
  const dockerfile = readFileSync(
    new URL("../Dockerfile", import.meta.url),
    "utf8"
  );
  const from = [...dockerfile.matchAll(/^FROM node:(\d+)-/gm)].map(m => m[1]);
  assert.ok(from.length >= 1);
  assert.ok(
    from.every(major => major === "22"),
    "Node 22 in every stage"
  );
  assert.match(dockerfile, /^RUN npm ci --include=dev\b/m);
  assert.match(dockerfile, /^RUN npm run build$/m);
  assert.match(dockerfile, /^CMD \["npm", "run", "start"\]$/m);
  // Build arguments end up in the image: only public values are allowed.
  const args = [...dockerfile.matchAll(/^ARG (\w+)/gm)].map(m => m[1]);
  for (const name of args)
    assert.ok(
      name.startsWith("NEXT_PUBLIC_") || name === "CSP_ENFORCE",
      `${name} must not be a build argument`
    );
  const workflow = readFileSync(
    new URL("../.github/workflows/image.yml", import.meta.url),
    "utf8"
  );
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /self-hosted/);
  const buildArgs = workflow.split("build-args: |")[1].split("\n\n")[0];
  assert.doesNotMatch(
    buildArgs,
    /secrets\./,
    "build args use public vars only"
  );
});
