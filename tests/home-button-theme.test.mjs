import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const css = postcss.parse(readFileSync("styles/home.css", "utf8"));

function rule(selector, parentParams = null) {
  let match;
  css.walkRules(candidate => {
    if (
      candidate.selector === selector &&
      (parentParams === null
        ? candidate.parent.type === "root"
        : candidate.parent.params === parentParams)
    )
      match = candidate;
  });
  return match;
}

function value(target, property) {
  return target?.nodes.find(node => node.prop === property)?.value;
}

test("Home panel actions reuse the Open pack palette and pill shape", () => {
  const action = rule(".yk-home-main .yk-button.yk-home-panel-action");
  assert.ok(action);
  assert.equal(value(action, "border-color"), "var(--color-pack-accent)");
  assert.equal(value(action, "border-radius"), "999px");
  assert.equal(value(action, "color"), "var(--color-pack-button-ink)");

  const background = value(action, "background");
  for (const token of [
    "pack-button-start",
    "pack-button-middle",
    "pack-button-end"
  ]) {
    assert.match(background, new RegExp(`var\\(--color-${token}\\)`));
  }

  assert.match(value(action, "box-shadow"), /var\(--color-pack-accent\)/);
});

test("Home panel actions keep matching hover and keyboard focus feedback", () => {
  const hover = rule(
    ".yk-home-main .yk-button.yk-home-panel-action:hover:not(:disabled)",
    "(hover: hover) and (pointer: fine)"
  );
  const focus = rule(
    ".yk-home-main .yk-button.yk-home-panel-action:focus-visible"
  );

  assert.ok(hover);
  assert.equal(hover.parent.params, "(hover: hover) and (pointer: fine)");
  assert.ok(focus);
  for (const target of [hover, focus]) {
    assert.equal(value(target, "border-color"), "var(--color-pack-accent)");
    assert.equal(value(target, "background"), "var(--color-veil-strong)");
    assert.equal(value(target, "box-shadow"), "var(--shadow-interactive)");
  }
});

test("Home panel actions stay fully reachable on narrow screens", () => {
  const heading = rule(".yk-home-panel-heading", "(max-width: 480px)");
  const action = rule(
    ".yk-home-main .yk-button.yk-home-panel-action",
    "(max-width: 480px)"
  );

  assert.equal(heading.parent.params, "(max-width: 480px)");
  assert.equal(value(heading, "align-items"), "center");
  assert.equal(value(heading, "gap"), "8px");
  assert.equal(action.parent.params, "(max-width: 480px)");
  assert.equal(value(action, "width"), "auto");
  assert.equal(value(action, "max-width"), "100%");
  assert.equal(value(action, "padding-inline"), "12px");
  assert.equal(value(action, "white-space"), "normal");
});
