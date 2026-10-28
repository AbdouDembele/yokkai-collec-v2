import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { homePresentation } from "./helpers/home-presentation.mjs";
import { assertBrandLogo } from "./helpers/brand-logo.mjs";

test("chrome logo preserves the supplied PNG dimensions", () => {
  const png = readFileSync("public/assets/brand-logo-chrome.png");
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  );
  assert.equal(png.readUInt32BE(16), 1672);
  assert.equal(png.readUInt32BE(20), 941);
});

for (const file of [
  "components/topbar.tsx",
  "app/page.tsx",
  "app/(auth)/layout.tsx",
  "app/reset-password/page.tsx"
]) {
  test(`${file} renders the chrome logo without changing its aspect ratio`, () => {
    const source =
      file === "app/page.tsx"
        ? homePresentation().header
        : readFileSync(file, "utf8");
    assertBrandLogo(source);
  });
}

for (const file of [
  "components/public-info-page.tsx",
  "app/premium/page.tsx"
]) {
  test(`${file} uses the same approved logo as the navigation`, () => {
    assert.equal(
      assertBrandLogo(readFileSync(file, "utf8")),
      assertBrandLogo(readFileSync("components/topbar.tsx", "utf8"))
    );
  });
}
