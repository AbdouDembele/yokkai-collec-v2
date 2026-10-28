import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("account menu shares the midnight-blue site surface without purple borders or hover states", () => {
  const css = readFileSync("styles/topbar.css", "utf8");
  const block = selector => {
    const start = css.indexOf(selector + " {");
    assert.ok(start >= 0, selector);
    return css.slice(start, css.indexOf("}", start) + 1);
  };
  const panel = block(".yk-account-panel");
  assert.match(panel, /background:\s*var\(--color-night\)/);
  assert.match(panel, /border: 1px solid #344964/);
  assert.doesNotMatch(panel, /#0f0c1d|#1d1844|82, 68, 181/);
  assert.match(
    block(".yk-account-action:focus-visible"),
    /background:\s*#101e33/
  );
  assert.match(block(".yk-account-actions"), /#344964/);
  assert.match(block(".yk-account-separator"), /#344964/);
  assert.match(block(".yk-account-summary > span"), /#526d91/);
  assert.match(block(".yk-account-action"), /color:\s*#b9c9df/);
  assert.match(block(".yk-account-logout"), /color:\s*#ff3355/);
});
