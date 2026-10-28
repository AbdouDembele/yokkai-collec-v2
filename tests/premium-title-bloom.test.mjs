import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Premium adds subtle bloom only to display headings, preserving crisp copy and the existing palette", () => {
  const css = readFileSync("styles/premium.css", "utf8");
  const bloom = css.slice(
    css.indexOf("/* A soft bloom"),
    css.indexOf(".yk-premium-nav {")
  );
  assert.match(bloom, /\.yk-premium-copy h1/);
  assert.match(bloom, /\.yk-pro-banner-copy h2/);
  assert.match(bloom, /\.yk-pro-profile-heading h2/);
  assert.match(bloom, /\.yk-pro-comparison h2/);
  assert.match(bloom, /text-shadow: 0 0 24px #efedf81f;/);
  assert.match(bloom, /currentColor 30%, transparent/);
  assert.match(bloom, /currentColor 14%, transparent/);
  assert.doesNotMatch(
    bloom,
    /filter:|font-size:|font-weight:|animation:|\bcolor:|\bp\s*[,\{]|button/
  );
});

test("text bloom is disabled for increased contrast and forced system colors", () => {
  const css = readFileSync("styles/premium.css", "utf8");
  assert.match(
    css,
    /@media \(prefers-contrast: more\), \(forced-colors: active\)\s*\{\s*\.yk-premium-page :is\(h1, h2, h1 em, h2 em\)\s*\{\s*text-shadow: none !important;/
  );
});
