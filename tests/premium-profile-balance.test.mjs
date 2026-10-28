import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the profile sidebar fills its lower area with genuine customization details", () => {
  const source = readFileSync("components/premium-profile-embed.tsx", "utf8");
  const details = source.indexOf('className="yk-pro-native-signature"');
  assert.ok(details > source.indexOf('href="/profile/BBDOU"'));
  assert.ok(details < source.indexOf("</aside>"));
  assert.match(source, /Made personal with Pro/);
  assert.match(source, /backgroundColor: style\.color/);
  assert.match(source, /backgroundColor: style\.secondary/);
  assert.match(source, /Avatar frames and decorative badges/);
  assert.match(source, /\{profile\.cards\.length\}/);
});

test("the sidebar stretches with the showcase and retains natural height on mobile", () => {
  const css = readFileSync("styles/premium.css", "utf8");
  assert.match(css, /\.yk-pro-native-profile\s*\{[^}]*align-items: stretch;/);
  assert.match(
    css,
    /\.yk-pro-native-identity\s*\{[^}]*display: flex;[^}]*flex-direction: column;/
  );
  assert.match(css, /\.yk-pro-native-signature\s*\{[^}]*margin: auto 24px 0;/);
  const signature = css.match(/\.yk-pro-native-signature\s*\{([^}]+)\}/)?.[1];
  assert.doesNotMatch(signature, /(?:min-)?height:|position: absolute/);
});
