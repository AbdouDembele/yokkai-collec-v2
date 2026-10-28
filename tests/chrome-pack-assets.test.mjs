import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { imageAsset } from "./helpers/visual-assets.mjs";

const assets = {
  regular: "2ecd0642c0a5b607254e5a3ced3eae428a64b07104680a4e4ee5aa66738ef235",
  decision: "0f81567d6bfe4d4e604b72069ed68e6f9d5635e247b592576aaec09531237377"
};

for (const [kind, hash] of Object.entries(assets)) {
  test(`chrome ${kind} pack preserves the supplied PNG and transparent margins`, async () => {
    const bytes = readFileSync(
      new URL(`../public/assets/chrome-${kind}-booster-v1.png`, import.meta.url)
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 941);
    assert.equal(info.height, 1672);
    assert.equal(info.channels, 4);
    let transparentMarginPixels = 0;
    for (let y = 500; y < 1000; y++) {
      for (let offset = 0; offset < 32; offset++) {
        for (const x of [offset, info.width - 1 - offset]) {
          if (data[(y * info.width + x) * 4 + 3] === 0)
            transparentMarginPixels++;
        }
      }
    }
    // Preserve the originals, including the supplied foil edge flecks.
    assert.ok(transparentMarginPixels / (500 * 32 * 2) > 0.95);
  });
}

test("chrome packs keep their native aspect ratio in the picker and tear layers", () => {
  const source = readFileSync(
    new URL("../components/boosters.tsx", import.meta.url),
    "utf8"
  );
  const regular = imageAsset(source, "yk-pack-image");
  const decision = imageAsset(source, "yk-pack-image yk-decision-image");
  assert.equal(regular, "/assets/chrome-regular-booster-v1.png");
  assert.equal(decision, "/assets/chrome-decision-booster-v1.png");
  assert.doesNotMatch(source, /yk-pack-tear/);
  const images = source
    .match(/<img\b[^>]*>/g)
    .filter(tag => /chrome-(?:regular|decision)-booster/.test(tag));
  assert.equal(images.length, 2);
  for (const image of images) {
    assert.match(image, /width=\{941\}/);
    assert.match(image, /height=\{1672\}/);
  }
  const css = readFileSync(
    new URL("../data/booster-opening/reveal.html", import.meta.url),
    "utf8"
  );
  assert.match(css, /packRatio/);
  assert.match(css, /object-fit:\s*contain/);
});
