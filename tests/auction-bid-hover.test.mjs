import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const market = postcss.parse(readFileSync("styles/market.css", "utf8"));
const packs = postcss.parse(
  readFileSync("styles/boosters-showcase.css", "utf8")
);
const actions = [".yk-bid-quick", ".yk-auction-offer-row > .yk-button"];

function hoverSelector(action) {
  return action === ".yk-bid-quick"
    ? `${action}:hover:not(:disabled)`
    : `${action}:not(:disabled):hover`;
}

function findRule(css, selector) {
  let found;
  css.walkRules(rule => {
    if (rule.selectors.includes(selector)) found = rule;
  });
  assert.ok(found, selector);
  return found;
}

test("auction bid actions share the pack Open hover without moving or recoloring amounts", () => {
  const packHover = findRule(
    packs,
    ".yk-pack-grid .yk-pack-panel .yk-pack-body > .yk-button:not(:disabled):hover"
  );
  for (const action of actions) {
    const hover = findRule(market, hoverSelector(action));
    assert.equal(hover.parent.name, "media");
    assert.equal(hover.parent.params, "(hover: hover) and (pointer: fine)");
    assert.deepEqual(
      hover.nodes.map(node => [node.prop, node.value]),
      [
        ...packHover.nodes.map(node => [node.prop, node.value]),
        ["border-color", "var(--color-pack-accent)"]
      ]
    );
    assert.deepEqual(
      hover.nodes.map(node => node.prop),
      ["background", "box-shadow", "border-color"]
    );
  }
});

test("keyboard focus gets the same enabled-only highlight and disabled bids never get it", () => {
  for (const action of actions) {
    const hover = findRule(market, hoverSelector(action));
    const focus = findRule(market, `${action}:not(:disabled):focus-visible`);
    assert.deepEqual(
      focus.nodes.map(node => [node.prop, node.value]),
      hover.nodes.map(node => [node.prop, node.value])
    );
    assert.equal(focus.parent.type, "root");
  }
  market.walkRules(rule => {
    if (
      rule.selectors.some(
        selector =>
          selector.includes(".yk-bid-quick") &&
          /:hover|:focus-visible/.test(selector)
      )
    ) {
      assert.ok(
        rule.selectors.every(selector => selector.includes(":not(:disabled)"))
      );
    }
  });
});
