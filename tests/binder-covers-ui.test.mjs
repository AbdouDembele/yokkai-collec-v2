import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      exports,
      URLSearchParams,
      Map,
      Math,
      Promise,
      require: name =>
        ["@/lib/data/cards", "@/lib/data/binders"].includes(name)
          ? {}
          : load(name.slice(2) + ".ts")
    }
  );
  return exports;
}
const { binderCover } = load("lib/ui/binder-discovery.ts"),
  { getHomeBinders } = load("lib/data/binder-discovery.ts");
test("catalogue covers work without owned cards and Home performs no redundant cover reads", async () => {
  const album = {
    binderKey: "series:one",
    license: "Cover",
    owned: 0,
    total: 2,
    percent: 0,
    favorite: true,
    image: "https://example.test/catalogue.png"
  };
  assert.equal(binderCover(album, []), album.image);
  const fallback = {
    id: "owned",
    image: "https://example.test/owned.png",
    binders: [{ key: album.binderKey }]
  };
  assert.equal(
    binderCover({ ...album, image: undefined }, [fallback]),
    fallback.image
  );
  let coverReads = 0;
  const result = await getHomeBinders({
    stable: () => true,
    enrich: async c => c,
    albums: async () => ({ items: [album], total: 1 }),
    cards: async () => {
      coverReads++;
      throw Error("No extra request expected");
    }
  });
  assert.equal(result[0].image, album.image);
  assert.equal(coverReads, 0);
});
