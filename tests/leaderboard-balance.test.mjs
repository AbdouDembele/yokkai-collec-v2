import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

test("Leaderboard loads zero and nonzero balances, refreshes changes and recovers from failures", async () => {
  const states = [];
  const requests = [];
  let index = 0;
  let effect;
  let listener;
  let unsubscribed = false;
  const exports = {};
  const source = ts.transpileModule(
    readFileSync("components/leaderboard-topbar.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name === "react")
        return {
          useState(initial) {
            const slot = index++;
            if (!(slot in states)) states[slot] = initial;
            return [
              states[slot],
              value => {
                states[slot] =
                  typeof value === "function" ? value(states[slot]) : value;
              }
            ];
          },
          useEffect(callback) {
            effect = callback;
          }
        };
      if (name === "@/components/topbar") return { Topbar: "topbar" };
      if (name === "@/lib/data/cards")
        return {
          getGameInfo: () =>
            new Promise((resolve, reject) => requests.push({ resolve, reject }))
        };
      if (name === "@/lib/data/player-state")
        return {
          subscribePlayerSnapshotInvalidation: callback => {
            listener = callback;
            return () => {
              unsubscribed = true;
            };
          }
        };
      return require(name);
    }
  });
  const render = () => {
    index = 0;
    return exports.LeaderboardTopbar({ account: "account menu" }).props;
  };
  assert.equal(render().karas, undefined);
  let cleanup = effect();
  requests.shift().resolve({ karasBalance: 0 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().karas, 0);
  listener(["profile"]);
  assert.equal(requests.length, 0);
  listener(["balance"]);
  requests.shift().resolve({ karasBalance: 7514 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().karas, 7514);
  listener(["balance"]);
  requests.shift().reject(new Error("offline"));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(render().infoError, /Couldn't load your balance/);
  render().onRetryInfo();
  cleanup();
  render();
  cleanup = effect();
  requests.shift().resolve({ karasBalance: 8000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().infoError, undefined);
  assert.equal(render().karas, 8000);
  assert.equal(render().view, "leaderboard");
  assert.equal(render().account, "account menu");
  listener(["balance"]);
  cleanup();
  requests.shift().resolve({ karasBalance: 9999 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().karas, 8000);
  assert.equal(unsubscribed, true);
});
