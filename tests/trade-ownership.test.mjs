import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, require = () => ({})) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    { exports, require }
  );
  return exports;
}
const groups = load("lib/ui/collection-groups.ts");
const { tradeOwnershipIndex } = load("lib/ui/trade-ownership.ts", () => groups);

test("trade ownership distinguishes catalogue IDs and normal, Shiny and Infinity copies", () => {
  const base = { id: "gojo", rarity: "SSR", shiny: false, isEvolved: false };
  const shiny = { ...base, shiny: true };
  const infinity = { ...base, shiny: true, isEvolved: true };
  const index = tradeOwnershipIndex([
    { ...base, count: 2 },
    base,
    { ...shiny, count: 4 },
    infinity
  ]);
  assert.equal(index.variants.get(groups.collectionGroupKey(base)), 3);
  assert.equal(index.variants.get(groups.collectionGroupKey(shiny)), 4);
  assert.equal(index.variants.get(groups.collectionGroupKey(infinity)), 1);
  assert.equal(
    index.variants.has(groups.collectionGroupKey({ ...base, id: "other" })),
    false
  );
  assert.equal(index.catalogue.has("gojo"), true);
  assert.equal(index.catalogue.has("other"), false);
  const onlyNormal = tradeOwnershipIndex([base]);
  assert.equal(
    onlyNormal.variants.has(groups.collectionGroupKey(shiny)),
    false
  );
  assert.equal(onlyNormal.catalogue.has(shiny.id), true);
  assert.equal(tradeOwnershipIndex([]).variants.size, 0);
});
