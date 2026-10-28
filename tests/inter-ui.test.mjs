import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the supplied variable Inter font is self-hosted with its license", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /src: "\.\/fonts\/inter\/InterVariable\.ttf"/);
  assert.match(layout, /weight: "100 900"/);
  assert.match(layout, /variable: "--font-inter"/);
  assert.match(layout, /\$\{inter\.variable\}/);
  const font = readFileSync("app/fonts/inter/InterVariable.ttf");
  assert.equal(
    createHash("sha256").update(font).digest("hex"),
    "0be2399ea925f1f83ff974764761da9860ec50742ed29a5d4c1ffd0c5c7ac3a8"
  );
  assert.match(
    readFileSync("app/fonts/inter/OFL.txt", "utf8"),
    /SIL OPEN FONT LICENSE Version 1\.1/
  );
});

test("interface and display tokens use Inter without changing card names", () => {
  const globals = readFileSync("app/globals.css", "utf8");
  const ui = readFileSync("styles/ui.css", "utf8");
  for (const token of ["sans", "display", "heading"]) {
    assert.match(globals, new RegExp(`--font-${token}: var\\(--font-inter\\)`));
  }
  assert.match(globals, /h1,\s*h2,\s*h3\s*\{\s*font-weight: 700;/);
  for (const token of ["sans", "display"]) {
    assert.match(ui, new RegExp(`--font-${token}: var\\(--font-inter\\)`));
  }
  assert.match(ui, /--font-card-name: var\(--font-cinzel\), Georgia, serif/);
  assert.match(
    readFileSync("styles/cards.css", "utf8"),
    /\.yk-card-name\s*\{[^}]*font-family: var\(--font-card-name\)/
  );
  const premium = readFileSync("styles/premium.css", "utf8");
  assert.doesNotMatch(premium, /--font-sora/);
  assert.match(premium, /--font-heading: var\(--font-display\)/);
});
