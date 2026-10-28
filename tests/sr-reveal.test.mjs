import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("le reveal SR possede un flash bref et un pulse sans reprendre le burst SSR/LR", () => {
  const source = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  const css = readFileSync(path.join(root, "styles/boosters.css"), "utf8");
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/rarity === "SR" && <div className="yk-sr-flash"/)
  );
  assert.doesNotMatch(
    source,
    /rarity === "SR"[^\n]*yk-(?:ssr|lr)-cinematic-stage/
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /\.yk-reveal-sr \.yk-face-up \{ animation: yk-sr-border-pulse/
    )
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/@keyframes yk-sr-flash/)
  );
});

test("SSR and LR use only the final sandbox cinematic", () => {
  const source = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  const css = readFileSync(path.join(root, "styles/boosters.css"), "utf8");
  assert.match(source, /if \(isLR \|\| isSSR\) \{/);
  assert.match(source, /<CardCinematic[^>]*card=\{spot\}/);
  assert.doesNotMatch(source, /yk-(?:ssr|lr)-cinematic-stage|4400|3200/);
  assert.doesNotMatch(
    css,
    /yk-(?:ssr|lr)-(?:deck-charge|godray|petal|spark|card-glow)/
  );
});

test("Shiny garde un chatoiement continu sur la carte", () => {
  const css = readFileSync(path.join(root, "styles/cards.css"), "utf8");
  assert.match(css, /\.yk-shiny\.yk-animated \.yk-card-art::after/);
  assert.match(css, /animation: yk-shiny-glint 3\.2s/);
});
