import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";

const game = readFileSync(
  new URL("../components/game.tsx", import.meta.url),
  "utf8"
);
const css = readFileSync(
  new URL("../styles/boosters.css", import.meta.url),
  "utf8"
);
const boosters = readFileSync(
  new URL("../components/boosters.tsx", import.meta.url),
  "utf8"
);

test("l'ouverture isole le clavier et restaure le focus sans scroll", () => {
  assert.match(boosters, /ref=\{openingStage\}/);
  assert.match(
    boosters,
    /openingPhase === "seal"[\s\S]*?focus\(\{\s*preventScroll:\s*true\s*\}\)/
  );
  assert.match(boosters, /element\.inert = true/);
  assert.match(boosters, /element\.inert = inert/);
  assert.match(boosters, /trigger\?\.isConnected/);
  assert.match(
    boosters,
    /event\.key\s*===\s*"Tab"[\s\S]*?event\.preventDefault\(\)/
  );
  assert.match(css, /\.yk-opening-stage:focus-visible/);
});

test("l'ouverture capture le bouton activé même si le navigateur ne le focalise pas", () => {
  const expression = boosters.match(/openingTrigger\.current = ([^;]+);/)[1];
  const capture = new Function(
    "trigger",
    "document",
    "HTMLElement",
    `return ${expression}`
  );
  class Element {
    constructor(tabIndex) {
      this.tabIndex = tabIndex;
    }
  }
  const body = new Element(-1);
  const button = new Element(0);
  assert.equal(capture(button, { activeElement: body }, Element), button);
  assert.equal(capture(undefined, { activeElement: body }, Element), null);
  assert.equal(capture(undefined, { activeElement: button }, Element), button);
  assert.match(boosters, /start\("regular", event\.currentTarget\)/);
  assert.match(boosters, /start\("decision", event\.currentTarget\)/);
});

test("la révélation remonte les cartes et masque le grand en-tête de page", () => {
  assert.match(game, /yk-game-main/);
  assert.match(game, /yk-pack-page-heading/);
  assert.match(
    css,
    /\.yk-game-main:has\(\.yk-reveal-screen\)[^{]*\{[^}]*padding-top:/
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/> \.yk-pack-page-heading \{ display: none; \}/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-reveal-screen \{ margin-top: 0; \}/)
  );
});
