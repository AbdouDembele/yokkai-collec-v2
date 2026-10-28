import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

test("enabled pack buttons share the Copy link primary-button hover", () => {
  const shared = postcss.parse(readFileSync("styles/ui.css", "utf8"));
  const packs = postcss.parse(
    readFileSync("styles/boosters-showcase.css", "utf8")
  );
  let primary;
  shared.walkRules(rule => {
    if (rule.selectors.includes(".yk-button-primary:hover:not(:disabled)"))
      primary = rule;
  });
  let hover;
  packs.walkRules(rule => {
    if (
      rule.selector ===
      ".yk-pack-grid .yk-pack-panel .yk-pack-body > .yk-button:not(:disabled):hover"
    )
      hover = rule;
  });
  assert.ok(primary);
  assert.ok(hover);
  assert.equal(hover.parent.params, "(hover: hover) and (pointer: fine)");
  for (const prop of ["background", "box-shadow"]) {
    const value = rule => rule.nodes.find(node => node.prop === prop)?.value;
    assert.ok(value(primary));
    assert.equal(value(hover), value(primary), prop);
  }
  assert.ok(
    hover.nodes.every(node => ["background", "box-shadow"].includes(node.prop))
  );
  const source = readFileSync("components/referral-reminder.tsx", "utf8");
  assert.match(source, /<Button[\s\S]*?className="yk-referral-reminder-copy/);
  assert.doesNotMatch(source, /variant="(?:secondary|danger)"/);
});
