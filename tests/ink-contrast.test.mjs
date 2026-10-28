import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(
  new URL("../tailwind.config.ts", import.meta.url),
  "utf8"
);
const color = name => {
  const match = config.match(
    new RegExp(`(?:"${name}"|${name}):\\s*"(#[0-9a-f]{6})"`, "i")
  );
  assert.ok(match, `Missing color token ${name}`);
  return match[1];
};
const luminance = hex => {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map(channel => {
      const s = parseInt(channel, 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
for (const background of ["night", "surface"]) {
  test(`ink-3 meets WCAG AA normal-text contrast on ${background}`, () => {
    const a = luminance(color("ink-3"));
    const b = luminance(color(background));
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    console.log(`ink-3 on ${background}: ${ratio.toFixed(3)}:1`);
    assert.ok(ratio >= 4.5, `${ratio.toFixed(3)}:1 is below 4.5:1`);
  });
}

for (const background of ["night", "surface"]) {
  test(`focus-ring meets 3:1 contrast on ${background}`, () => {
    const a = luminance(color("focus-ring"));
    const b = luminance(color(background));
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    console.log(`focus-ring on ${background}: ${ratio.toFixed(3)}:1`);
    assert.ok(ratio >= 3, `${ratio.toFixed(3)}:1 is below 3:1`);
  });
}
