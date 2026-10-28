import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const home = postcss.parse(readFileSync("styles/home.css", "utf8"));
const auth = postcss.parse(readFileSync("styles/auth.css", "utf8"));
const declarations = (root, selector) => {
  const rule = root.nodes.find(node => node.selector === selector);
  assert.ok(rule, selector);
  return Object.fromEntries(
    rule.nodes
      .filter(node => node.type === "decl")
      .map(node => [node.prop, node.value])
  );
};

test("home display titles reuse the authentication heading font", () => {
  const reference = declarations(auth, ".yk-auth-showcase-heading h2");
  for (const selector of [
    ".yk-home-hero h1",
    ".yk-home-discord h2",
    ".yk-home-referral h2"
  ]) {
    const title = declarations(home, selector);
    assert.equal(title["font-family"], reference["font-family"], selector);
    assert.equal(title["font-weight"], reference["font-weight"], selector);
  }
  assert.equal(
    declarations(home, ".yk-home-hero")["--font-heading"],
    "var(--font-display)"
  );
});

test("the emphasized home line uses the same upright style as authentication", () => {
  assert.equal(
    declarations(home, ".yk-home-hero h1 em")["font-style"],
    declarations(auth, ".yk-auth-showcase-heading h2 em")["font-style"]
  );
  assert.equal(
    declarations(home, ".yk-home-hero h1 em").color,
    "var(--color-accent-gold)"
  );
});

test("panel headings share the Friend feed title size", () => {
  for (const selector of [
    ".yk-home-panel h2",
    ".yk-home-discord h2",
    ".yk-home-referral h2"
  ]) {
    assert.equal(
      declarations(home, selector)["font-size"],
      "var(--home-panel-title-size)"
    );
  }
  assert.equal(
    declarations(home, ".yk-home-main")["--home-panel-title-size"],
    "25px"
  );
  const feed = readFileSync("styles/friend-feed.css", "utf8");
  assert.match(feed, /font-size: var\(--home-panel-title-size, 25px\)/);
});
