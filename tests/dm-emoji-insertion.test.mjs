import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/ui/message-emoji.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText,
  { exports }
);
const { insertMessageEmoji } = exports;
test("DM emojis replace the selection and return a UTF-16 caret without altering adjacent text", () => {
  const next = insertMessageEmoji("Hello friend", "❤️", 6, 12);
  assert.equal(next.text, "Hello ❤️");
  assert.equal(next.caret, 8);
  const middle = insertMessageEmoji("abcd", "😂", 1, 3);
  assert.equal(middle.text, "a😂d");
  assert.equal(middle.caret, 3);
  const appended = insertMessageEmoji("Hi", "🫶", 2, 2);
  assert.equal(appended.text, "Hi🫶");
  assert.equal(appended.caret, 4);
});
test("DM emoji insertion respects textarea capacity and never truncates multi-codepoint emojis", () => {
  assert.equal(insertMessageEmoji("x".repeat(1999), "😂", 1999, 1999), null);
  const replaced = insertMessageEmoji("x".repeat(2000), "😂", 1998, 2000);
  assert.equal(replaced.text.length, 2000);
  assert.equal(replaced.text.slice(-2), "😂");
  assert.equal(replaced.caret, 2000);
  const empty = insertMessageEmoji("", "❤️", 0, 0);
  assert.equal(empty.text, "❤️");
});

test("auction emoji insertion respects the 500-character limit and selection replacement", () => {
  assert.equal(insertMessageEmoji("x".repeat(499), "😂", 499, 499, 500), null);
  const next = insertMessageEmoji("x".repeat(500), "😂", 498, 500, 500);
  assert.equal(next.text.length, 500);
  assert.equal(next.text.slice(-2), "😂");
  assert.equal(next.caret, 500);
});
