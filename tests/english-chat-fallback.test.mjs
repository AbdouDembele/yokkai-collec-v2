import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("player chat load and polling fallbacks are English", () => {
  const source = readFileSync(
    new URL("../components/community-views.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /Chat indisponible\./);
  assert.equal(source.match(/: "Chat unavailable\."/g)?.length, 2);
});
