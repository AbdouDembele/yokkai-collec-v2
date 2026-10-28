import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { imageAsset } from "./helpers/visual-assets.mjs";

const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the selected booster artwork is used in the picker and the final sandbox tear layers", () => {
  const source = read("components/boosters.tsx");
  const regular = imageAsset(source, "yk-pack-image");
  const decision = imageAsset(source, "yk-pack-image yk-decision-image");
  for (const path of [regular, decision]) {
    assert.equal(source.split(path).length - 1, 1);
  }
  assert.match(
    read("lib/ui/booster-opening-document.ts"),
    /chrome-\$\{kind\}-booster-v1\.png/
  );
  const document = read("data/booster-opening/reveal.html");
  assert.match(document, /packBody\.src = url;/);
  assert.match(document, /packLid\.src = url;/);
  assert.doesNotMatch(source, /yk-pack-tear/);
});

test("shared card backs use the matching bubble artwork", () => {
  assert.match(
    read("styles/cards.css"),
    /url\("\/assets\/bubble-card-back-v1\.png"\) center \/ cover\s+no-repeat/
  );
});

for (const [name, width, height] of [
  ["regular-booster", 1024, 1536],
  ["decisive-booster", 1024, 1536],
  ["card-back", 1060, 1484]
]) {
  test(`${name} asset preserves its native PNG dimensions`, () => {
    const png = readFileSync(
      new URL(`../public/assets/bubble-${name}-v1.png`, import.meta.url)
    );
    assert.deepEqual(
      png.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  });
}
