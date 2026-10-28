import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

test("Karas use brighter gold with static metallic gem facets, not blurred or animated numbers", () => {
  const css = postcss.parse(readFileSync("styles/ui.css", "utf8"));
  let color;
  let text;
  let gem;
  css.walkDecls("--color-karas-readable-gold", declaration => {
    color = declaration.value;
  });
  css.walkRules(rule => {
    if (rule.selectors.includes(".yk-karas-gold")) text = rule;
    if (rule.selectors.includes(".yk-karas-gold .yk-karas-gem")) gem = rule;
  });
  assert.equal(color, "#ffda75");
  assert.deepEqual(
    text.nodes.map(node => node.prop),
    ["color"]
  );
  const declarations = Object.fromEntries(
    gem.nodes.map(node => [node.prop, node.value])
  );
  assert.match(declarations.background, /radial-gradient\(/);
  assert.match(declarations.background, /linear-gradient\(/);
  assert.match(declarations.background, /#fffdf3/);
  assert.match(declarations.background, /#c08318 47%/);
  assert.match(declarations.background, /#fff1ba 52%/);
  assert.match(declarations["box-shadow"], /inset 1px 1px 1px/);
  assert.match(declarations["box-shadow"], /inset -1px -1px 1px/);
  assert.match(declarations["box-shadow"], /0 0 13px/);
  assert.deepEqual(Object.keys(declarations), ["background", "box-shadow"]);
  assert.equal(declarations.animation, undefined);
});
