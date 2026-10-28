import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, require = () => ({})) {
  const context = {
    exports: {},
    require,
    setTimeout,
    clearTimeout,
    AbortController,
    Date,
    Map,
    Set,
    Promise
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }).outputText,
    context
  );
  return context.exports;
}
const reads = load("../lib/data/read-request.ts");
const copies = load("../lib/ui/pack-opening.ts");
const snapshots = load("../lib/data/player-state.ts");
test("a hung request aborts, rejects and can be retried", async () => {
  let signal;
  await assert.rejects(
    reads.readRequest(value => {
      signal = value;
      return new Promise(() => {});
    }, 10),
    /15 seconds/
  );
  assert.equal(signal.aborted, true);
  assert.equal(await reads.readRequest(async () => 42, 10), 42);
  assert.equal(reads.READ_TIMEOUT_MS, 15000);
});
test("each page has its own deadline; retry resumes only the failed page; a short page ends pagination", async () => {
  const checkpoint = { rows: [] };
  const calls = [];
  let fail = true;
  const read = async cursor => {
    calls.push(cursor ?? "first");
    return reads.readRequest(async () => {
      await new Promise(resolve => setTimeout(resolve, 8));
      if (!cursor) return [{ id: "a" }, { id: "b" }];
      if (fail) return new Promise(() => {});
      return [{ id: "c" }];
    }, 15);
  };
  await assert.rejects(reads.resumePages(checkpoint, 2, read));
  assert.deepEqual(checkpoint.rows, [{ id: "a" }, { id: "b" }]);
  fail = false;
  const result = await reads.resumePages(checkpoint, 2, read);
  assert.deepEqual(result, [{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(calls, ["first", "b", "b"]);
});
test("NEW and duplicates are absent for empty/loading, partial and late collections; complete snapshot stays frozen", () => {
  const draw = [{ id: "owned" }, { id: "new" }, { id: "new" }];
  for (const partial of [[], [{ id: "owned" }]]) {
    const snapshot = copies.packCopySnapshot(partial, false);
    partial.push({ id: "owned" });
    assert.ok(
      copies
        .packCopyLabels(draw, snapshot)
        .every(card => card.isNew === undefined && card.copies === undefined)
    );
  }
  const collection = [{ id: "owned" }];
  const snapshot = copies.packCopySnapshot(collection, true);
  collection.push({ id: "new" });
  assert.deepEqual(
    Array.from(copies.packCopyLabels(draw, snapshot), card => [
      card.isNew,
      card.copies
    ]),
    [
      [false, 2],
      [true, 1],
      [false, 2]
    ]
  );
});
test("wishlist drops are flagged from the pre-opening snapshot, even without a collection", () => {
  const draw = [{ id: "wanted" }, { id: "other" }, { id: "wanted" }];
  const flags = snapshot =>
    Array.from(
      copies.packCopyLabels(draw, snapshot, new Set(["wanted"])),
      card => card.wishlisted
    );
  assert.deepEqual(flags(null), [true, undefined, true]);
  assert.deepEqual(flags({}), [true, undefined, true]);
  assert.ok(
    copies.packCopyLabels(draw, {}).every(card => card.wishlisted === undefined)
  );
});
test("invalidation during a pending read revalidates sequentially without concurrent duplicates or stale results", async () => {
  const cache = snapshots.createPlayerSnapshotCache();
  let release;
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const loader = async () => {
    const call = ++calls;
    maxActive = Math.max(maxActive, ++active);
    if (call === 1)
      await new Promise(resolve => {
        release = resolve;
      });
    active--;
    return call;
  };
  const first = cache.memo("collection:alice", 10000, loader);
  cache.deleteScope("collection");
  const second = cache.memo("collection:alice", 10000, loader);
  assert.equal(first, second);
  release();
  assert.deepEqual(await Promise.all([first, second]), [2, 2]);
  assert.equal(maxActive, 1);
});

test("admin read shares its promise, expires after five minutes and clears on account changes and sign-out", async () => {
  let now = 0;
  let id = "alice";
  let calls = 0;
  const listeners = [];
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: id ? { user: { id } } : null }
      }),
      onAuthStateChange: fn => {
        listeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      }
    },
    rpc(name) {
      assert.equal(name, "is_current_user_admin");
      calls++;
      const result = Promise.resolve({ data: id === "alice", error: null });
      result.abortSignal = () => result;
      return result;
    }
  };
  const admin = load("../hooks/use-is-admin.ts", name => {
    if (name === "react") return {};
    if (name === "@/utils/supabase/client")
      return { createClient: () => client };
    if (name === "@/lib/data/read-request") return reads;
    if (name === "@/lib/data/player-state")
      return {
        createPlayerSnapshotCache: () =>
          snapshots.createPlayerSnapshotCache(() => now)
      };
    assert.fail(name);
  });
  assert.deepEqual(
    await Promise.all([admin.getIsAdmin(), admin.getIsAdmin()]),
    [true, true]
  );
  assert.equal(calls, 1);
  now = 299999;
  assert.equal(await admin.getIsAdmin(), true);
  assert.equal(calls, 1);
  now = 300001;
  await admin.getIsAdmin();
  assert.equal(calls, 2);
  id = "bob";
  listeners.forEach(fn => fn("SIGNED_IN", { user: { id } }));
  assert.equal(await admin.getIsAdmin(), false);
  assert.equal(calls, 3);
  id = null;
  listeners.forEach(fn => fn("SIGNED_OUT", null));
  assert.equal(await admin.getIsAdmin(), false);
  assert.equal(calls, 3);
  id = "alice";
  listeners.forEach(fn => fn("SIGNED_IN", { user: { id } }));
  assert.equal(await admin.getIsAdmin(), true);
  assert.equal(calls, 4);
});
