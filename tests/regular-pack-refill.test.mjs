import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("regular packs refresh at the refill deadline and cancel stale timers", () => {
  const source = readFileSync("components/game.tsx", "utf8");
  const ast = ts.createSourceFile(
    "game.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let effect;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[1]?.getText(ast) === "[view, status?.nextPackAt]"
    )
      effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect, "regular pack refill must schedule a deadline refresh");
  let callback,
    delay,
    cleared,
    reads = 0;
  const context = {
    view: "packs",
    status: { available: 9, maximum: 10, nextPackAt: 6000 },
    document: { hidden: false },
    Date: { now: () => 1000 },
    retries: { current: { regular: () => reads++ } },
    window: {
      setTimeout(fn, ms) {
        callback = fn;
        delay = ms;
        return 42;
      },
      clearTimeout(id) {
        cleared = id;
      }
    }
  };
  const run = () => vm.runInNewContext(`(${effect})()`, context);
  const cleanup = run();
  assert.equal(delay, 5100);
  assert.equal(reads, 0);
  callback();
  assert.equal(reads, 1);
  context.document.hidden = true;
  callback();
  assert.equal(reads, 1);
  cleanup();
  assert.equal(cleared, 42);
  callback = undefined;
  context.status.nextPackAt = null;
  assert.equal(run(), undefined);
  assert.equal(callback, undefined);
  context.status.nextPackAt = 6000;
  context.view = "collection";
  assert.equal(run(), undefined);
  assert.equal(callback, undefined);
});
