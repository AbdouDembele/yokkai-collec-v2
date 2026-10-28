import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load() {
  let now = 0;
  const context = {
    exports: {},
    window: undefined,
    BroadcastChannel: undefined,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    Set,
    Map,
    Promise
  };
  const source = ts.transpileModule(
    readFileSync(
      new URL("../lib/data/player-state.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText;
  vm.runInNewContext(source, context);
  return {
    api: context.exports,
    advance: value => {
      now += value;
    }
  };
}

test("les snapshots conservent la déduplication et les TTL Collection/solde", async () => {
  const { api, advance } = load();
  const cache = api.createPlayerSnapshotCache();
  let collectionLoads = 0;
  let balanceLoads = 0;
  const collection = () =>
    cache.memo(
      "collection:alice",
      api.PLAYER_SNAPSHOT_TTL.collection,
      async () => ++collectionLoads
    );
  const balance = () =>
    cache.memo(
      "info:alice",
      api.PLAYER_SNAPSHOT_TTL.balance,
      async () => ++balanceLoads
    );
  await Promise.all([collection(), collection(), balance(), balance()]);
  assert.deepEqual([collectionLoads, balanceLoads], [1, 1]);
  advance(10_001);
  await Promise.all([collection(), balance()]);
  assert.deepEqual([collectionLoads, balanceLoads], [2, 1]);
  advance(50_000);
  await balance();
  assert.equal(balanceLoads, 2);
});

test("l’invalidation est ciblée, dédupliquée et dormante sans publication", () => {
  const { api } = load();
  const received = [];
  const unsubscribe = api.subscribePlayerSnapshotInvalidation(scopes =>
    received.push(Array.from(scopes))
  );
  assert.deepEqual(received, []);
  api.publishPlayerSnapshotInvalidation([
    "collection",
    "balance",
    "collection"
  ]);
  assert.deepEqual(received, [["balance", "collection"]]);
  unsubscribe();
  api.publishPlayerSnapshotInvalidation(["balance"]);
  assert.equal(received.length, 1);
});
