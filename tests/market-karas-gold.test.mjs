import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

test("market card prices reuse the readable gold text and gem without recoloring timers or frames", () => {
  const css = postcss.parse(readFileSync("styles/ui.css", "utf8"));
  const rules = [];
  css.walkRules(rule => {
    if (rule.selectors.includes(".yk-market-price")) rules.push(rule);
  });
  assert.equal(rules.length, 1);
  assert.deepEqual(
    rules[0].nodes.map(node => node.prop),
    ["color"]
  );
  assert.equal(rules[0].nodes[0].value, "var(--color-karas-readable-gold)");
  assert.ok(rules[0].selectors.includes(".yk-karas-gold"));
  assert.ok(
    !rules[0].selectors.some(selector => /timer|seller/.test(selector))
  );
  const gemRules = [];
  css.walkRules(rule => {
    if (rule.selectors.includes(".yk-market-price .yk-karas-gem"))
      gemRules.push(rule);
  });
  assert.equal(gemRules.length, 1);
  assert.ok(gemRules[0].selectors.includes(".yk-karas-gold .yk-karas-gem"));
  assert.deepEqual(
    gemRules[0].nodes.map(node => node.prop),
    ["background", "box-shadow"]
  );
  assert.match(gemRules[0].nodes[0].value, /#f2ca72/);
  assert.match(
    readFileSync("components/community-views.tsx", "utf8"),
    /<Karas amount=\{a\.amount\} className="yk-market-price"/
  );
});
