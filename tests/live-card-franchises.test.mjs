import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function setup() {
  const requests = [];
  const client = {
    auth: { onAuthStateChange: () => {} },
    from: table => {
      const q = {
        select: () => q,
        in: (column, ids) => {
          requests.push(ids);
          return q;
        },
        then: resolve =>
          resolve({
            data: requests.at(-1).map(id => ({ id, franchise: "LIVE " + id })),
            error: null
          })
      };
      return q;
    }
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../lib/data/cards.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    {
      exports,
      Map,
      Set,
      Promise,
      require: name =>
        ({
          "@/utils/supabase/client": { createClient: () => client },
          "@/lib/data/read-request": {},
          "@/lib/ui/card-search": {},
          "@/lib/data/player-state": {
            createPlayerSnapshotCache: () => ({}),
            subscribePlayerSnapshotInvalidation: () => {}
          }
        })[name]
    }
  );
  return { api: exports, requests };
}
test("current SQL cards skip franchise hydration while old front/base and historical snapshots retain fallback", async () => {
  const h = setup();
  const fresh = {
    id: "fresh",
    anime: "CURRENT",
    liveFranchise: true,
    instanceId: "keep"
  };
  const result = await h.api.withLiveCardFranchises([fresh]);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [fresh]);
  const old = { id: "old", anime: "STALE", instanceId: "legacy" };
  const mixed = await h.api.withLiveCardFranchises([fresh, old, old]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests)), [["old"]]);
  assert.equal(mixed[0].anime, "CURRENT");
  assert.equal(mixed[1].anime, "LIVE old");
  assert.equal(mixed[2].instanceId, "legacy");
});

test("fresh SQL franchises retain trimming and the missing-franchise representation", async () => {
  const h = setup();
  const cards = [
    { id: "spaced", anime: "  LIVE  ", liveFranchise: true },
    { id: "null", anime: null, liveFranchise: true },
    { id: "empty", anime: "", liveFranchise: true }
  ];
  const result = await h.api.withLiveCardFranchises(cards);
  assert.equal(h.requests.length, 0);
  assert.equal(result[0].anime, "LIVE");
  assert.equal(result[1].anime, undefined);
  assert.equal(result[2].anime, undefined);
});
