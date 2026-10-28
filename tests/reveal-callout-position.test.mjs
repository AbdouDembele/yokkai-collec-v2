import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("rare labels belong to the single native player, with no old callout beneath it", () => {
  assert.doesNotMatch(
    read("components/boosters.tsx"),
    /yk-(?:ssr|lr|shiny)-callout/
  );
  assert.doesNotMatch(
    read("styles/boosters.css"),
    /yk-callout|reveal-card-half-height/
  );
  assert.match(read("components/lr-card-reveal.tsx"), /<YokaiCard/);
  assert.match(read("styles/lr-card-reveal.css"), /\.yk-card-badge/);
  assert.match(read("styles/lr-card-reveal.css"), /\.yk-card-name/);
});
