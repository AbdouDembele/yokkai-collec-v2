import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the real subscription card lives once in the left hero column", () => {
  const source = readFileSync("components/premium-offer.tsx", "utf8");
  const copy = source.indexOf('<div className="yk-premium-copy">');
  const checkout = source.indexOf(
    "<PremiumCheckout signedIn={signedIn} billing={billing} />"
  );
  const visual = source.indexOf('className="yk-pro-hero-showcase"');
  assert.ok(copy >= 0 && checkout > copy && checkout < visual);
  assert.equal((source.match(/<PremiumCheckout\b/g) || []).length, 1);
  assert.doesNotMatch(
    source,
    /yk-pro-membership-section|yk-pro-showcase-chrome/
  );
  const card = readFileSync("components/premium-checkout.tsx", "utf8");
  assert.match(card, /€4\.99/);
  assert.match(card, /\/settings#subscription/);
  assert.match(card, /billing\?\.checkoutEnabled/);
  assert.match(card, />\s*GET PRO\s*</);
  assert.match(card, /fetch\("\/api\/billing\/checkout"/);
  assert.match(card, /https:\/\/checkout\.stripe\.com/);
  assert.match(card, /pending\.current/);
});

test("hero booster artwork has neither a surrounding window nor individual frames", () => {
  const css = readFileSync("styles/premium.css", "utf8");
  for (const selector of [
    /\.yk-pro-hero-showcase\s*\{([^}]+)\}/,
    /\.yk-pro-card-gains > div\s*\{([^}]+)\}/
  ]) {
    const rule = css.match(selector)?.[1];
    assert.ok(rule);
    assert.match(rule, /border:\s*0;/);
    assert.match(rule, /background:\s*transparent;/);
  }
  const source = readFileSync("components/premium-offer.tsx", "utf8");
  assert.match(source, /chrome-regular-booster-v1\.png/);
  assert.match(source, /chrome-decision-booster-v1\.png/);
  assert.match(source, /60 \/ rules\.pro\.regularPackMinutes/);
});
