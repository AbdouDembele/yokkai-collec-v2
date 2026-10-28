import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const css = read("styles/boosters-showcase.css");

test("showcase styles affect pack selection only, not reveal or opening stages", () => {
  assert.match(
    read("app/layout.tsx"),
    /import "\.\.\/styles\/boosters-showcase\.css"/
  );
  postcss.parse(css).walkRules(rule => {
    for (const selector of rule.selectors) {
      assert.match(selector, /\.yk-(?:pack-|game-main:has\(\.yk-pack-grid\))/);
      assert.doesNotMatch(selector, /yk-reveal|yk-opening|yk-card/);
    }
  });
  assert.doesNotMatch(css, /content:\s*["'][^"']+["']/);
});

test("showcase includes responsive columns, visible keyboard focus and reduced motion", () => {
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /:disabled/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none/);
  assert.match(css, /transition: none/);
});
