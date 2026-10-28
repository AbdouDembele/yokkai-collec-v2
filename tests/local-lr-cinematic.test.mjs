import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
test("retired LR standalone player, endpoint and embedded assets are removed", () => {
  for (const file of [
    "components/local-lr-cinematic.tsx",
    "lib/ui/lr-cinematic-document.ts",
    "app/design-system/lr-cinematic/document/route.ts",
    "data/lr-cinematic/reveal.html",
    "data/card-cinematics/lr.html"
  ]) {
    assert.equal(
      existsSync(new URL(`../${file}`, import.meta.url)),
      false,
      file
    );
  }
});
