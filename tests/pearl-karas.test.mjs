import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Karas use the site's light ink and a cool pearl gem, without changing rarity gold", () => {
  const config = readFileSync("tailwind.config.ts", "utf8");
  const colors = config.match(/colors:\s*\{([\s\S]+?)\n\s*\}/)?.[1];
  const ink = colors?.match(/\bink:\s*"([^"]+)"/)?.[1];
  const karas = colors?.match(/\bkaras:\s*"([^"]+)"/)?.[1];
  assert.ok(ink);
  assert.equal(karas, ink);
  assert.match(
    config,
    /karas:\s*"linear-gradient\(135deg,#F2F0FF,#C0C5FF 55%,#8A84AB\)"/
  );
  assert.match(colors, /"rarity-lr":\s*"#E8C26A"/);
  assert.match(colors, /"accent-gold":\s*"#FFD47D"/);
  const ui = readFileSync("styles/ui.css", "utf8");
  const gem = ui.match(/\.yk-karas-gem\s*\{([^}]+)\}/)?.[1];
  assert.match(gem, /background:\s*var\(--background-karas\)/);
  assert.match(gem, /var\(--color-karas\)/);
  assert.doesNotMatch(gem, /accent-gold|shadow-gold/);
});

test("quick bids reuse the Open pack button palette, pill and cool glow", () => {
  const css = readFileSync("styles/market.css", "utf8");
  const packs = readFileSync("styles/boosters-showcase.css", "utf8");
  const bid = css.match(/\.yk-bid-quick\s*\{([^}]+)\}/)?.[1];
  assert.ok(bid);
  for (const token of [
    "pack-accent",
    "pack-button-ink",
    "pack-button-start",
    "pack-button-middle",
    "pack-button-end"
  ]) {
    assert.ok(bid.includes(`var(--color-${token})`), token);
    assert.ok(packs.includes(`var(--color-${token})`), token);
  }
  assert.match(bid, /border-radius:\s*999px/);
  assert.doesNotMatch(bid, /accent-gold|shadow-gold/);
  assert.match(css, /\.yk-bid-quick span\s*\{[^}]*color:\s*inherit/);
  const hover = css.match(
    /\.yk-bid-quick:hover:not\(:disabled\)\s*\{([^}]+)\}/
  )?.[1];
  assert.match(hover, /var\(--color-pack-accent\)/);
  assert.doesNotMatch(hover, /accent-gold|shadow-gold/);
  assert.match(
    css,
    /\.yk-auction-countdown\.yk-urgency-critical\s*\{[^}]*var\(--color-danger-ink\)/
  );
});
