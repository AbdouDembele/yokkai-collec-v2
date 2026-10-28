import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("les cartes du marché gardent leur plan animé sans bouton de suivi", () => {
  const source = readFileSync(
    path.join(root, "components/community-views.tsx"),
    "utf8"
  );
  const tile = source.slice(
    source.indexOf("function AuctionTile("),
    source.indexOf("const marketEmptyStates")
  );
  assert.match(
    tile,
    /<CardShell>[\s\S]*?<Link[\s\S]*?<YokaiCard[\s\S]*?<\/Link>\s*<\/CardShell>/
  );
  assert.equal((tile.match(/<WatchButton/g) ?? []).length, 0);
});

test("le shell conserve le ratio 5:7 et ne modifie pas la face", () => {
  const card = readFileSync(
    path.join(root, "components/yokai-card.tsx"),
    "utf8"
  );
  const shell = readFileSync(
    path.join(root, "components/card-shell.tsx"),
    "utf8"
  );
  const css = readFileSync(path.join(root, "styles/card-shell.css"), "utf8");
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(/\.yk-card-shell[^}]*aspect-ratio:\s*5 \/ 7/s)
  );
  assert.match(
    normalizeWhitespace(shell),
    normalizeWhitespace(
      /\{children\}<span className="yk-card-shell-reflection"/
    )
  );
  assert.match(
    normalizeWhitespace(card),
    normalizeWhitespace(/className={`yk-card yk-rarity-/)
  );
});

test("le tilt ne rerend pas React et anime seulement transform et opacite", () => {
  const shell = readFileSync(
    path.join(root, "components/card-shell.tsx"),
    "utf8"
  );
  const css = readFileSync(path.join(root, "styles/card-shell.css"), "utf8");
  assert.doesNotMatch(
    normalizeWhitespace(shell),
    normalizeWhitespace(/useState|setState/)
  );
  assert.match(
    normalizeWhitespace(shell),
    normalizeWhitespace(/requestAnimationFrame/)
  );
  assert.match(
    normalizeWhitespace(shell),
    normalizeWhitespace(/addEventListener\("pointermove"/)
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /\.yk-card-shell:hover \.yk-card-shell-plane[^}]*will-change:\s*transform;/s
    )
  );
  assert.match(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /\.yk-card-shell:hover \.yk-card-shell-reflection[^}]*will-change:\s*transform,opacity;/s
    )
  );
  assert.doesNotMatch(
    normalizeWhitespace(css),
    normalizeWhitespace(
      /transition:[^;]*(?:top|left|width|height|background-position)/
    )
  );
});

test("le shell interactif est neutralise pour tactile et mouvement reduit", () => {
  const shell = readFileSync(
    path.join(root, "components/card-shell.tsx"),
    "utf8"
  );
  const css = readFileSync(path.join(root, "styles/card-shell.css"), "utf8");
  assert.match(shell, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(shell, /event\.pointerType === "touch"/);
  assert.match(shell, /prefers-reduced-motion: reduce/);
  assert.match(
    css,
    /@media \(hover: none\), \(pointer: coarse\), \(prefers-reduced-motion: reduce\)/
  );
  assert.match(css, /--shell-reflect-opacity:\s*0 !important/);
});

test("les reveals et la confirmation Decision Pack gardent les composants directs", () => {
  const boosters = readFileSync(
    path.join(root, "components/boosters.tsx"),
    "utf8"
  );
  assert.doesNotMatch(
    normalizeWhitespace(boosters),
    normalizeWhitespace(/CardShell/)
  );
  assert.match(
    normalizeWhitespace(boosters),
    normalizeWhitespace(
      /<span className="yk-flip-back"[^>]*><CardBack \/><\/span><span className="yk-flip-front"[^>]*>\{faceUp && <YokaiCard \{\.\.\.current\} \/>\}/
    )
  );
  assert.match(
    normalizeWhitespace(boosters),
    normalizeWhitespace(
      /title=\{tp\("keepNamedCard", \{ name: chosen\?\.name \|\| tp\("thisCard"\) \}\)\}[^]*?<YokaiCard \{\.\.\.chosen\} \/>/
    )
  );
});
