import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const listeners = new Map(),
    documentListeners = new Map(),
    intervals = new Map(),
    timeouts = new Map();
  let nextTimer = 0,
    actionPending = false;
  const calls = [],
    updates = [],
    failures = [];
  const events = map => ({
    addEventListener: (type, listener) => map.set(type, listener),
    removeEventListener: type => map.delete(type)
  });
  const document = { visibilityState: "visible", ...events(documentListeners) };
  const window = {
    ...events(listeners),
    setInterval: (callback, ms) => {
      assert.equal(ms, 30000);
      const id = ++nextTimer;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: id => intervals.delete(id),
    setTimeout: (callback, ms) => {
      assert.equal(ms, 10000);
      const id = ++nextTimer;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout: id => timeouts.delete(id)
  };
  const loaded = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../lib/billing/status-sync.ts", import.meta.url),
        "utf8"
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    {
      module: loaded,
      exports: loaded.exports,
      document,
      window,
      AbortController,
      fetch: (url, options) => {
        assert.equal(url, "/api/billing/status");
        assert.equal(options.cache, "no-store");
        return new Promise((resolve, reject) =>
          calls.push({ resolve, reject, signal: options.signal })
        );
      }
    }
  );
  const stop = loaded.exports.watchBillingStatus(
    status => updates.push(status),
    () => failures.push(true),
    () => actionPending
  );
  const reply = async (index, state, ok = true) => {
    calls[index].resolve({ ok, json: async () => state });
    await tick();
  };
  return {
    calls,
    updates,
    failures,
    listeners,
    documentListeners,
    intervals,
    timeouts,
    document,
    stop,
    reply,
    setPending: value => {
      actionPending = value;
    }
  };
}
test("server status synchronizes on load, focus, visibility, BFCache return, network recovery and visible polling without overlapping requests", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 1);
  f.listeners.get("focus")();
  f.documentListeners.get("visibilitychange")();
  assert.equal(f.calls.length, 1);
  await f.reply(0, { active: true, cancelAtPeriodEnd: false });
  for (const event of ["focus", "pageshow", "online"]) {
    f.listeners.get(event)();
    await f.reply(f.calls.length - 1, {
      active: true,
      cancelAtPeriodEnd: true
    });
  }
  assert.equal(f.calls.length, 4);
  f.document.visibilityState = "hidden";
  f.documentListeners.get("visibilitychange")();
  [...f.intervals.values()][0]();
  assert.equal(f.calls.length, 4);
  f.document.visibilityState = "visible";
  f.documentListeners.get("visibilitychange")();
  await f.reply(4, { active: false, status: "canceled" });
  assert.equal(f.updates.at(-1).active, false);
  [...f.intervals.values()][0]();
  await f.reply(5, { active: false, status: "canceled" });
  f.setPending(true);
  f.listeners.get("focus")();
  assert.equal(f.calls.length, 6);
  f.stop();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.documentListeners.size, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timeouts.size, 0);
});
test("failed status reads never grant access, retry automatically and abort/ignore late responses after unmount", async () => {
  const f = fixture();
  await f.reply(0, { active: true }, false);
  assert.equal(f.updates.length, 0);
  assert.equal(f.failures.length, 1);
  f.listeners.get("online")();
  await f.reply(1, { active: false });
  assert.equal(f.updates.at(-1).active, false);
  f.listeners.get("focus")();
  const before = f.updates.length;
  f.stop();
  assert.equal(f.calls[2].signal.aborted, true);
  await f.reply(2, { active: true });
  assert.equal(f.updates.length, before);
  assert.equal(f.failures.length, 1);
  assert.equal(f.intervals.size, 0);
});
