import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

test("regular booster keeps transparent side margins through the logo band", async () => {
  const { data, info } = await sharp(
    "public/assets/bubble-regular-booster-v1.png"
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1536);
  assert.equal(info.channels, 4);
  for (let y = 500; y < 1000; y++) {
    for (let offset = 0; offset < 40; offset++) {
      for (const x of [offset, info.width - 1 - offset]) {
        assert.equal(
          data[(y * info.width + x) * 4 + 3],
          0,
          `Opaque margin at ${x},${y}`
        );
      }
    }
  }
});
