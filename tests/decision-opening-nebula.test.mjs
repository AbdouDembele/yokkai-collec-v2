import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";

const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the supplied pink nebula is scoped to the decision pack opening", async () => {
  const source = read("components/boosters.tsx");
  assert.match(source, /setOpeningKind\(kind\)/);
  assert.match(source, /kind=\{openingKind\}/);
  const adapter = read("lib/ui/booster-opening-document.ts");
  assert.match(adapter, /\$\{kind\}-opening-nebula\.webp/);
  assert.match(adapter, /center \/ cover no-repeat/);

  const metadata = await sharp(
    readFileSync(
      new URL("../public/assets/decision-opening-nebula.webp", import.meta.url)
    )
  ).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1672);
  assert.equal(metadata.height, 941);
});
