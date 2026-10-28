import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync(
    new URL("../lib/server/image-cache.ts", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }
).outputText;
const context = { exports: {}, Uint8Array, Map, Promise };
vm.runInNewContext(source, context);
const { ByteLruCache, RenderCache } = context.exports;

test("le LRU est borné en octets et rafraîchit l'entrée lue", () => {
  const cache = new ByteLruCache(6);
  cache.set("a", new Uint8Array(3));
  cache.set("b", new Uint8Array(3));
  assert.ok(cache.get("a"));
  cache.set("c", new Uint8Array(3));
  assert.equal(cache.get("b"), undefined);
  assert.ok(cache.get("a"));
  assert.ok(cache.get("c"));
  assert.equal(cache.bytes, 6);
  cache.set("too-large", new Uint8Array(7));
  assert.equal(cache.get("too-large"), undefined);
  assert.equal(cache.bytes, 6);
});

test("deux requêtes simultanées partagent exactement un rendu", async () => {
  const cache = new RenderCache(1024);
  let renders = 0;
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const render = async () => {
    renders += 1;
    await gate;
    return new Uint8Array([1, 2, 3]);
  };
  const first = cache.getOrRender("share:og", render);
  const second = cache.getOrRender("share:og", render);
  await Promise.resolve();
  assert.equal(renders, 1);
  release();
  assert.equal(await first, await second);
  assert.equal(renders, 1);
  assert.equal(await cache.getOrRender("share:og", render), await first);
  assert.equal(renders, 1);
});

test("le cache ne laisse pas plus de deux rendus travailler à la fois", async () => {
  const cache = new RenderCache(1024, 2);
  let active = 0;
  let peak = 0;
  const releases = [];
  const render = () =>
    new Promise(resolve => {
      active += 1;
      peak = Math.max(peak, active);
      releases.push(() => {
        active -= 1;
        resolve(new Uint8Array([1]));
      });
    });
  const renders = [0, 1, 2].map(index =>
    cache.getOrRender(`share:${index}`, render)
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(peak, 2);
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(peak, 2);
  releases.splice(0).forEach(release => release());
  await Promise.all(renders);
});
