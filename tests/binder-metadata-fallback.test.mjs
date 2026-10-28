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
