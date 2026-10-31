import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/ui/select-typeahead.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText,
  { exports }
);
const { normalizeChoiceLabel, advanceTypeahead, typeaheadMatchIndex } = exports;

test("Letters match accents, case and decorative title prefixes", () => {
  assert.equal(normalizeChoiceLabel("  'École"), "ecole");
  assert.equal(
    typeaheadMatchIndex(["Naruto", "Éden", "[C] Control"], "e", -1),
    1
  );
  assert.equal(
    typeaheadMatchIndex(["Naruto", "Éden", "[C] Control"], "c", -1),
    2
  );
  assert.equal(typeaheadMatchIndex(["86", "009-1"], "0", -1), 1);
});
test("Repeated letters cycle and wrap without changing the selection on no match", () => {
  const labels = ["Naruto", "Bleach", "Noragami"];
  assert.equal(typeaheadMatchIndex(labels, "n", 0), 2);
  assert.equal(typeaheadMatchIndex(labels, "n", 2), 0);
  assert.equal(typeaheadMatchIndex(labels, "z", 0), -1);
  assert.equal(typeaheadMatchIndex([], "n", -1), -1);
});
test("Several letters refine a prefix while idle typing starts a new jump", () => {
  let buffer = advanceTypeahead({ text: "", updatedAt: 0 }, "n", 1000);
  buffer = advanceTypeahead(buffer, "n", 1100);
  assert.equal(buffer.text, "n");
  buffer = advanceTypeahead(buffer, "o", 1200);
  assert.equal(buffer.text, "no");
  assert.equal(typeaheadMatchIndex(["Naruto", "Noragami"], buffer.text, 0), 1);
  buffer = advanceTypeahead(buffer, "b", 2200);
  assert.equal(buffer.text, "b");
});

test("Punctuation inside a typed name remains part of the prefix", () => {
  let buffer = advanceTypeahead({ text: "", updatedAt: 0 }, "a", 1000);
  buffer = advanceTypeahead(buffer, "-", 1100);
  assert.equal(buffer.text, "a-");
  assert.equal(typeaheadMatchIndex(["ACCA", "A-Channel"], buffer.text, 0), 1);
});
