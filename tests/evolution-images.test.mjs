import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const context = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../lib/ui/evolution-images.ts", import.meta.url),
      "utf8"
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText,
  context
);
const { orderEvolutionCopies } = context.exports;
test("Evolution suggestions, preview and RPC order agree on the selected custom image", () => {
  const plain = { instanceId: "plain", customImageUrl: null };
  const a = { instanceId: "a", customImageUrl: "https://i.imgur.com/a.png" };
  const b = { instanceId: "b", customImageUrl: "https://i.imgur.com/b.png" };
  const copies = [plain, a, b];
  const ids = rows => Array.from(rows, row => row.instanceId);
  assert.deepEqual(ids(orderEvolutionCopies(copies, "b")), ["b", "plain", "a"]);
  assert.deepEqual(ids(orderEvolutionCopies(copies, "plain")), [
    "a",
    "plain",
    "b"
  ]);
  assert.deepEqual(ids(orderEvolutionCopies(copies, "missing")), [
    "a",
    "plain",
    "b"
  ]);
  assert.deepEqual(
    ids(orderEvolutionCopies([plain], "b")),
    ["plain"],
    "An unselected custom image cannot be inherited"
  );
  assert.deepEqual(ids(orderEvolutionCopies([], "b")), []);
  assert.deepEqual(
    ids(copies),
    ["plain", "a", "b"],
    "Ordering does not mutate the collection"
  );
  const normal = Array.from({ length: 10 }, (_, index) => ({
    instanceId: `normal-${index}`,
    customImageUrl: null
  }));
  const suggested = orderEvolutionCopies([...normal, b], "b").slice(0, 5);
  assert.equal(suggested.length, 5);
  assert.equal(
    suggested[0],
    b,
    "The displayed custom copy is included even when ten normal copies are available"
  );
  assert.equal(new Set(ids(suggested)).size, 5);
});
