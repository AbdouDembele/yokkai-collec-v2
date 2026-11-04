import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("optional binder enrichment retains cards for both API errors and thrown network/deadline failures", async () => {
  for (const throws of [false, true]) {
    const cards = [
      {
        id: "card",
        instanceId: "owned",
        customImageUrl: "https://i.imgur.com/kept.png"
      }
    ];
    let warnings = 0;
    const context = {
      exports: {},
      console: {
        warn() {
          warnings++;
        }
      },
      process: { env: { NEXT_PUBLIC_STABLE_BINDERS_ENABLED: "true" } },
      require(name) {
        if (name === "@/utils/supabase/client")
          return {
            createClient: () => ({
              rpc: () => ({
                abortSignal: async () => {
                  if (throws) throw Error("The request timed out");
                  return { data: null, error: Error("API unavailable") };
                }
              })
            })
          };
        if (name === "@/lib/data/read-request")
          return { readRequest: load => load(new AbortController().signal) };
        throw Error(name);
      }
    };
    vm.runInNewContext(
      ts.transpileModule(
        readFileSync(
          new URL("../lib/data/binders.ts", import.meta.url),
          "utf8"
        ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020
          }
        }
      ).outputText,
      context
    );
    assert.equal(await context.exports.withBinderMetadata(cards), cards);
    assert.equal(warnings, 1);
    assert.equal(cards[0].customImageUrl, "https://i.imgur.com/kept.png");
  }
});

test("binder metadata is cached per card: only missing or expired cards are requested", async () => {
  const requests = [];
  let failNext = false;
  let now = 1_000_000;
  const context = {
    exports: {},
    console: { warn() {} },
    Date: { now: () => now },
    process: { env: { NEXT_PUBLIC_STABLE_BINDERS_ENABLED: "true" } },
    require(name) {
      if (name === "@/utils/supabase/client")
        return {
          createClient: () => ({
            rpc: (_fn, args) => ({
              abortSignal: async () => {
                requests.push([...args.p_card_ids]);
                if (failNext) {
                  failNext = false;
                  return { data: null, error: Error("API unavailable") };
                }
                return {
                  data: args.p_card_ids
                    .filter(id => id !== "loose")
                    .map(id => ({
                      card_id: id,
                      binders: [
                        { key: `source:${id}`, name: id, origin: "source" }
                      ]
                    })),
                  error: null
                };
              }
            })
          })
        };
      if (name === "@/lib/data/read-request")
        return { readRequest: load => load(new AbortController().signal) };
      throw Error(name);
    }
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../lib/data/binders.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020
        }
      }
    ).outputText,
    context
  );
  const { withBinderMetadata, BINDER_METADATA_TTL_MS } = context.exports;
  const keys = cards =>
    JSON.parse(JSON.stringify(cards.map(card => card.binders.map(b => b.key))));

  const first = await withBinderMetadata([
    { id: "a" },
    { id: "b" },
    { id: "loose" }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [["a", "b", "loose"]]);
  assert.deepEqual(keys(first), [["source:a"], ["source:b"], []]);

  // Same cards, including one without binder: no request.
  const again = await withBinderMetadata([
    { id: "b" },
    { id: "loose" },
    { id: "a" }
  ]);
  assert.equal(requests.length, 1);
  assert.deepEqual(keys(again), [["source:b"], [], ["source:a"]]);

  // Only the new card is requested.
  await withBinderMetadata([{ id: "a" }, { id: "c" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(requests))[1], ["c"]);

  // A failed lookup keeps the cards untouched and caches nothing.
  failNext = true;
  const cards = [{ id: "d" }];
  assert.equal(await withBinderMetadata(cards), cards);
  await withBinderMetadata([{ id: "d" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)).slice(2), [
    ["d"],
    ["d"]
  ]);

  // Expired entries are requested again.
  now += BINDER_METADATA_TTL_MS + 1;
  await withBinderMetadata([{ id: "a" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)).at(-1), ["a"]);
});
