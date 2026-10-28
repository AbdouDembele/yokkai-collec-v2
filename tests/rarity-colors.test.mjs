import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("card-tokens reste la source de verite des couleurs R et SR", () => {
  const tokens = readFileSync(
    path.join(root, "styles/card-tokens.css"),
    "utf8"
  );
  const tailwind = readFileSync(path.join(root, "tailwind.config.ts"), "utf8");
  const globals = readFileSync(path.join(root, "app/globals.css"), "utf8");

  assert.match(
    normalizeWhitespace(tokens),
    normalizeWhitespace(/--rarity-r:\s*#E8EDF5/)
  );
  assert.match(
    normalizeWhitespace(tokens),
    normalizeWhitespace(/--rarity-sr:\s*#C9A8E0/)
  );
  assert.match(
    normalizeWhitespace(tokens),
    normalizeWhitespace(
      /\.yk-rarity-R[^}]*--card-badge:\s*linear-gradient\(160deg,#FFFFFF,#AEB6C6\)/s
    )
  );
  assert.match(
    normalizeWhitespace(tokens),
    normalizeWhitespace(
      /\.yk-rarity-SR[^}]*--card-badge:\s*var\(--rarity-sr\)/s
    )
  );
  assert.match(
    normalizeWhitespace(tailwind),
    normalizeWhitespace(/["']rarity-r["']:\s*["']var\(--rarity-r\)["']/)
  );
  assert.match(
    normalizeWhitespace(tailwind),
    normalizeWhitespace(/["']rarity-sr["']:\s*["']var\(--rarity-sr\)["']/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(tailwind),
    normalizeWhitespace(/["']rarity-(?:r|sr)["']:\s*["']#[0-9A-F]{6}["']/i)
  );
  assert.match(
    normalizeWhitespace(globals),
    normalizeWhitespace(/@import "\.\.\/styles\/card-tokens\.css"/)
  );
});
