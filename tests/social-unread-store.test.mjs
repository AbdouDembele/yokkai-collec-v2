import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(load) {
  const window = new EventTarget();
  const document = new EventTarget();
  document.hidden = false;
  let poll,
    stopped = 0,
    refresh,
    reset;
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../lib/ui/social-unread-store.ts", import.meta.url),
        "utf8"
      ),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS }
      }
    ).outputText,
    {
      exports,
      window,
      document,
      require: () => ({
        startVisiblePolling: callback => {
          poll = callback;
          callback();
          return () => stopped++;
        }
      })
    }
  );
  const store = exports.createSocialUnreadStore({
    load,
    subscribe: (r, s) => {
      refresh = r;
      reset = s;
      return () => stopped++;
    }
  });
  return {
    store,
    window,
    document,
    refresh: () => refresh(),
    reset: () => reset(),
    poll: () => poll(),
    stopped: () => stopped
  };
}
const summary = (viewerId, count = 1) => ({
  viewerId,
  messageCount: count,
  requestCount: 0,
  messages: []
});

test("navigation and friend rows share one feed, deduplicate concurrent triggers and unsubscribe completely", async () => {
  let calls = 0,
    resolve;
  const f = fixture(() => {
    calls++;
    return new Promise(r => (resolve = r));
  });
  let renders = 0;
  const a = f.store.subscribe(() => renders++);
  const b = f.store.subscribe(() => renders++);
  assert.equal(calls, 1);
  f.refresh();
  f.poll();
  f.window.dispatchEvent(new Event("focus"));
  assert.equal(calls, 1);
  resolve(summary("alice", 9));
  await tick();
  assert.equal(
    f.store.getSnapshot(),
    undefined,
    "Invalidation discards an older in-flight result"
  );
  assert.equal(calls, 2, "Triggers are coalesced into one follow-up refresh");
  resolve(summary("alice", 2));
  await tick();
  assert.equal(f.store.getSnapshot().messageCount, 2);
  assert.equal(renders, 2);
  a();
  assert.equal(f.stopped(), 0);
  b();
  assert.equal(f.stopped(), 2);
  assert.equal(f.store.getSnapshot(), undefined);
  f.window.dispatchEvent(new Event("social-unread-changed"));
  assert.equal(calls, 2);
});
test("logout/account switch clears immediately and rejects a late previous identity response", async () => {
  let resolve;
  const f = fixture(() => new Promise(r => (resolve = r)));
  const stop = f.store.subscribe(() => {});
  resolve(summary("alice", 3));
  await tick();
  assert.equal(f.store.getSnapshot().viewerId, "alice");
  f.refresh();
  f.reset();
  f.refresh();
  assert.equal(f.store.getSnapshot(), undefined);
  resolve(summary("alice", 99));
  await tick();
  assert.equal(f.store.getSnapshot(), undefined);
  resolve(summary("bob", 1));
  await tick();
  assert.equal(f.store.getSnapshot().viewerId, "bob");
  stop();
});
test("hidden pages do not poll or clear counts; transient errors preserve the last confirmed state", async () => {
  let fail = false,
    calls = 0;
  const f = fixture(async () => {
    calls++;
    if (fail) throw Error("offline");
    return summary("alice", 5);
  });
  const stop = f.store.subscribe(() => {});
  await tick();
  f.document.hidden = true;
  f.poll();
  f.refresh();
  assert.equal(calls, 1);
  assert.equal(f.store.getSnapshot().messageCount, 5);
  f.document.hidden = false;
  fail = true;
  f.poll();
  await tick();
  assert.equal(f.store.getSnapshot().messageCount, 5);
  fail = false;
  f.poll();
  await tick();
  assert.equal(calls, 3);
  stop();
});
