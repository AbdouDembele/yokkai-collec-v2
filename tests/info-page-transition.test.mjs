import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

test("public information pages enter without widening the document", () => {
  const css = readFileSync("styles/info-pages.css", "utf8");
  const root = postcss.parse(css);
  const rule = root.nodes.find(
    node =>
      node.type === "rule" &&
      node.selector === ".yk-page-transition:has(.yk-info-page)"
  );
  assert.ok(rule);
  const declarations = rule.nodes.filter(node => node.type === "decl");
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].prop, "--page-enter-scale");
  assert.equal(declarations[0].value, "1");
  assert.doesNotMatch(rule.toString(), /overflow|animation\s*:/);
  const shared = readFileSync("styles/ui.css", "utf8");
  assert.match(shared, /animation: yk-page-enter/);
  assert.match(
    shared,
    /@keyframes yk-page-enter[\s\S]*opacity: 0;[\s\S]*scale\(var\(--page-enter-scale\)\)[\s\S]*opacity: 1;/
  );
});
