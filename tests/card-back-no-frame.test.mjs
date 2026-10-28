import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

test("card backs display their transparent artwork without a black or gold CSS frame", () => {
  const css = readFileSync(
    new URL("../styles/cards.css", import.meta.url),
    "utf8"
  );
  const rules = postcss
    .parse(css)
    .nodes.filter(
      node => node.type === "rule" && node.selector === ".yk-card-back"
    );
  assert.equal(rules.length, 1);
  const declarations = Object.fromEntries(
    rules[0].nodes
      .filter(node => node.type === "decl")
      .map(node => [node.prop, node.value])
  );
  assert.equal(declarations.border, "none");
  assert.equal(declarations["box-shadow"], "none");
  assert.match(
    declarations.background,
    /^transparent url\("\/assets\/bubble-card-back-v1\.png"\) center \/ cover\s+no-repeat$/
  );
  assert.equal(declarations.width, "100%");
  assert.equal(declarations["aspect-ratio"], "5 / 7");
  assert.equal(declarations["border-radius"], "12px");
  assert.doesNotMatch(
    rules[0].toString(),
    /--color-accent-gold|#050507|--color-void/
  );
});
