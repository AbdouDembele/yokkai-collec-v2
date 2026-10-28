import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/ui/color-wheel.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText,
  { exports }
);
const { hexToHsv, hsvToHex } = exports;

test("the wheel maps hue, saturation and brightness to exact RGB colors", () => {
  assert.equal(hsvToHex(0, 1, 1), "#ff0000");
  assert.equal(hsvToHex(120, 1, 1), "#00ff00");
  assert.equal(hsvToHex(240, 1, 1), "#0000ff");
  assert.equal(hsvToHex(-120, 1, 1), "#0000ff");
  assert.equal(hsvToHex(360, 1, 1), "#ff0000");
  assert.equal(hsvToHex(100, 0, 1), "#ffffff");
  assert.equal(hsvToHex(100, 1, 0), "#000000");
  for (let r = 0; r < 256; r += 23)
    for (let g = 0; g < 256; g += 23)
      for (let b = 0; b < 256; b += 23) {
        const hex =
          "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
        const hsv = hexToHsv(hex);
        assert.equal(hsvToHex(hsv.h, hsv.s, hsv.v), hex);
      }
});
