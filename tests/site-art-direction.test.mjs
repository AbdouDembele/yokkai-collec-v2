import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertBrandLogo } from "./helpers/brand-logo.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("la direction artistique globale conserve un fond fixe et le logo chrome", () => {
  const globals = readFileSync(path.join(root, "styles/ui.css"), "utf8");
  const topbar = readFileSync(path.join(root, "styles/topbar.css"), "utf8");
  const component = readFileSync(
    path.join(root, "components/topbar.tsx"),
    "utf8"
  );
  assert.match(globals, /body\s*\{[^}]*background-color:/s);
  assert.match(globals, /body\s*\{[^}]*background-image:/s);
  assert.match(globals, /background-attachment:\s*fixed/);
  assertBrandLogo(component);
  assert.match(topbar, /backdrop-filter:\s*blur\(10px\) saturate\(118%\)/);
  assert.match(topbar, /background:\s*#fff/);
});

test("le fond reste stable sur mobile et avec les animations réduites", () => {
  const globals = readFileSync(path.join(root, "styles/ui.css"), "utf8");
  assert.match(
    globals,
    /@media \(max-width: 760px\), \(prefers-reduced-motion: reduce\)/
  );
  assert.match(globals, /background-attachment:\s*scroll/);
});

test("the boosters route uses the backdrop matching its approved UI palette", () => {
  const globals = readFileSync(path.join(root, "styles/ui.css"), "utf8");
  const boosters = readFileSync(path.join(root, "styles/boosters.css"), "utf8");
  const layout = readFileSync(
    path.join(root, "app/boosters/layout.tsx"),
    "utf8"
  );

  assert.doesNotMatch(globals, /yokkai-site-backdrop\.webp/);
  assert.match(
    globals,
    /linear-gradient\(180deg, #08090d 0%, #06070a 35%, #040506 100%\)/
  );
  assert.match(layout, /className="yk-boosters-page"/);
  assert.match(boosters, /\.yk-boosters-page\s*\{/);
  assert.match(boosters, /rgba\(36, 52, 110, 0\.22\)/);
  const tokens = readFileSync(path.join(root, "tailwind.config.ts"), "utf8");
  assert.match(
    boosters,
    tokens.includes('"pack-accent": "#bccdff"')
      ? /rgba\(34, 55, 98, 0\.16\)/
      : /rgba\(64, 34, 98, 0\.16\)/
  );
  assert.match(
    boosters,
    /linear-gradient\(180deg, #08090f 0%, #05060a 35%, #040509 100%\)/
  );
});
