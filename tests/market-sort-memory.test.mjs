import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const key = "yokkai:market:sort:v1";
const source = readFileSync(
  new URL("../lib/ui/market-sort.ts", import.meta.url),
  "utf8"
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

function fixture({ stored, blocked = false, browser = true } = {}) {
  const storage = new Map(stored === undefined ? [] : [[key, stored]]);
  const writes = [];
  const renders = [];
  let server = false;
  const exports = {};
  const globals = {
    exports,
    require(name) {
      assert.equal(name, "react");
      return {
        useSyncExternalStore(subscribe, snapshot, serverSnapshot) {
          const render = { subscribe, snapshot, serverSnapshot, updates: 0 };
          renders.push(render);
          return server ? serverSnapshot() : snapshot();
        }
      };
    }
  };
  if (browser)
    globals.window = {
      sessionStorage: {
        getItem(k) {
          if (blocked) throw new Error("Blocked");
          return storage.get(k) ?? null;
        },
        setItem(k, value) {
          if (blocked) throw new Error("Blocked");
          writes.push([k, value]);
          storage.set(k, value);
        }
      }
    };
  vm.runInNewContext(code, globals);
  return {
    exports,
    storage,
    writes,
    renders,
    hook() {
      return exports.useMarketSort();
    },
    ssr() {
      server = true;
      const result = exports.useMarketSort();
      server = false;
      return result;
    }
  };
}

test("each explicit Market sort survives list unmount, detail navigation and remount", () => {
  for (const sort of ["end", "asc", "desc", "popular"]) {
    const f = fixture();
    const [initial, choose] = f.hook();
    assert.equal(initial, "end");
    choose(sort);
    assert.equal(f.storage.get(key), sort);
    const [restored] = f.hook();
    assert.equal(restored, sort);
    // A reload creates a fresh JS module but keeps this tab's sessionStorage.
    assert.equal(fixture({ stored: f.storage.get(key) }).hook()[0], sort);
    assert.deepEqual(
      f.writes,
      [[key, sort]],
      "mount/remount must never overwrite the remembered choice"
    );
  }
});

test("the server snapshot stays deterministic without losing the client choice", () => {
  const f = fixture({ stored: "popular" });
  assert.equal(f.ssr()[0], "end");
  assert.equal(f.hook()[0], "popular");
  assert.deepEqual(f.writes, []);
  const server = fixture({ browser: false });
  server.hook()[1]("asc");
  assert.equal(server.hook()[0], "end");
});

test("reset filters explicitly persists Ending soon and other tabs start fresh", () => {
  const f = fixture({ stored: "desc" });
  const [restored, reset] = f.hook();
  assert.equal(restored, "desc");
  reset("end");
  assert.equal(f.hook()[0], "end");
  assert.equal(f.storage.get(key), "end");
  assert.equal(fixture().hook()[0], "end");
});

test("invalid storage is ignored and unavailable storage does not break navigation", () => {
  for (const stored of ["", "recent", "{", "null", "undefined", "<script>"])
    assert.equal(fixture({ stored }).hook()[0], "end");
  const f = fixture({ blocked: true });
  const [, choose] = f.hook();
  choose("popular");
  assert.equal(f.hook()[0], "popular");
  choose("end");
  assert.equal(f.hook()[0], "end");
  choose("invalid");
  assert.equal(f.hook()[0], "end");
});

test("subscribers receive changes and unmounting releases their subscription", () => {
  const f = fixture();
  const [, choose] = f.hook();
  const render = f.renders[0];
  const stop = render.subscribe(() => render.updates++);
  choose("asc");
  assert.equal(render.updates, 1);
  assert.equal(render.snapshot(), "asc");
  stop();
  choose("desc");
  assert.equal(render.updates, 1);
});
