import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
test("the bell refreshes on confirmed reads and queues one refresh behind an older in-flight response", async () => {
  const effects = [],
    updates = [],
    resolvers = [];
  const window = new EventTarget();
  let calls = 0;
  let active = 0,
    maxActive = 0;
  const load = () => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise(resolve =>
      resolvers.push(v => {
        active--;
        resolve(v);
      })
    );
  };
  const react = {
    useState: initial => [initial, next => updates.push(next)],
    useRef: initial => ({ current: initial }),
    useCallback: fn => fn,
    useEffect: fn => effects.push(fn)
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("hooks/use-notification-feed.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    {
      exports,
      window,
      document: { hidden: false },
      console,
      process: { env: { NODE_ENV: "production" } },
      require: n =>
        n === "react"
          ? react
          : n === "@/lib/data/notifications"
            ? {}
            : n === "@/lib/data/cards"
              ? { invalidatePlayerSnapshots() {} }
              : n === "@/lib/ui/visible-polling"
                ? {
                    startVisiblePolling: fn => {
                      fn();
                      return () => {};
                    }
                  }
                : {}
    }
  );
  exports.useNotificationFeed(true, load);
  const cleanup = effects[0]();
  assert.equal(calls, 1);
  window.dispatchEvent(new Event("social-unread-changed"));
  window.dispatchEvent(new Event("social-unread-changed"));
  assert.equal(calls, 1);
  resolvers.shift()([
    { id: "message", type: "private_message_received", readAt: null }
  ]);
  await flush();
  assert.equal(
    calls,
    2,
    "Read acknowledgement cannot be lost behind a stale unread response"
  );
  resolvers.shift()([
    { id: "message", type: "private_message_received", readAt: "confirmed" }
  ]);
  await flush();
  assert.equal(updates.filter(Array.isArray).at(-1)[0].readAt, "confirmed");
  assert.equal(maxActive, 1);
  const ignored = new Event("storage");
  ignored.key = "unrelated";
  window.dispatchEvent(ignored);
  assert.equal(calls, 2);
  const changed = new Event("storage");
  changed.key = "yokkai:social-unread-invalidation";
  window.dispatchEvent(changed);
  assert.equal(calls, 3);
  resolvers.shift()([]);
  await flush();
  cleanup();
  window.dispatchEvent(new Event("social-unread-changed"));
  assert.equal(calls, 3);
});
