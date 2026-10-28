import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { englishMessages } from "./helpers/i18n.mjs";

test("the supplied ice-blue retro logo is unchanged and used by every shared header", () => {
  const png = readFileSync("public/assets/brand-logo-ice-retro.png");
  assert.equal(
    createHash("sha256").update(png).digest("hex"),
    "35d3805bb96fa6c4a039f51cefdcfa9b1a15e5115322f4fca8c37cc596e560d2"
  );
  assert.equal(png.readUInt32BE(16), 1672);
  assert.equal(png.readUInt32BE(20), 941);
  assert.equal(png[25], 6, "RGBA transparency must be preserved");
  for (const file of [
    "components/topbar.tsx",
    "components/public-info-page.tsx",
    "app/(auth)/layout.tsx",
    "app/reset-password/page.tsx",
    "app/premium/page.tsx"
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /src="\/assets\/brand-logo-ice-retro\.png"\s+alt=""\s+width=\{1672\}\s+height=\{941\}/
    );
    assert.doesNotMatch(source, /brand-logo-(?:blue|chrome)\.png/);
    const localizedHeaders = {
      "components/topbar.tsx": "topbar",
      "app/(auth)/layout.tsx": "layout",
      "app/reset-password/page.tsx": "page"
    };
    if (localizedHeaders[file]) {
      assert.match(source, /aria-label=\{t\("yokkaiCollecHome"\)\}/);
      assert.equal(
        englishMessages[localizedHeaders[file]].yokkaiCollecHome,
        "Yokkai Collec’, home"
      );
    } else assert.match(source, /aria-label="Yokkai Collec/);
  }
  assert.match(
    readFileSync("lib/server/card-share-image.tsx", "utf8"),
    /brand-logo-ice-retro\.png/
  );
  assert.match(
    readFileSync("styles/ui.css", "utf8"),
    /img\[src\*="brand-logo-ice-retro\.png"\]/
  );
});
