import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../hooks/use-sfx.ts", import.meta.url),
  "utf8"
);

test("les effets mobiles utilisent une session ambient sans interrompre l'audio externe", () => {
  assert.match(source, /session\.type = "ambient"/);
  assert.match(source, /if \(!mobile\) return "media"/);
  // Sans session ambient (Android) : Web Audio, qui ne prend pas le focus audio.
  assert.match(source, /if \(!session\) return "web-audio"/);
  assert.match(source, /nonInterruptingAudioMode\(\) === "web-audio"/);
  assert.match(source, /new AudioContext\(\)/);
  assert.doesNotMatch(
    source.slice(
      source.indexOf('=== "web-audio"'),
      source.indexOf("let audio")
    ),
    /new Audio\(/
  );
});
