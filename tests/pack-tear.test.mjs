import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("legacy tear is deleted, with no import or renderer left", () => {
  assert.equal(
    existsSync(new URL("../styles/pack-tear.css", import.meta.url)),
    false
  );
  assert.doesNotMatch(read("app/layout.tsx"), /pack-tear/);
  assert.doesNotMatch(
    read("components/boosters.tsx"),
    /yk-pack-tear|runPackOpeningSequence|releasedOpening/
  );
  assert.match(read("components/boosters.tsx"), /<BoosterOpening/);
});
