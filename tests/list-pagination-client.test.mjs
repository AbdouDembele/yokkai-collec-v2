import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup(path, handler) {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return handler(name, args);
    }
  };
  const context = {
    exports: {},
    require: name => {
      if (name.startsWith("@/messages/trade-limits/"))
        return {
          __esModule: true,
          default: JSON.parse(
            readFileSync(
              new URL("../" + name.slice(2), import.meta.url),
              "utf8"
            )
          )
        };
      if (name === "@/utils/supabase/client")
        return { createClient: () => client };
      if (name === "@/lib/data/cards")
        return {
          withLiveCardFranchises: async cards => cards,
          invalidatePlayerSnapshots() {}
        };
      if (name === "@/lib/data/rpc-pages.mjs") {
        const nested = { exports: {} };
        vm.runInNewContext(
          ts.transpileModule(
            readFileSync(
              new URL("../lib/data/rpc-pages.mjs", import.meta.url),
              "utf8"
            ),
            { compilerOptions: { module: ts.ModuleKind.CommonJS } }
          ).outputText,
          nested
        );
        return nested.exports;
      }
      assert.fail(name);
    }
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }).outputText,
    context
  );
  return { api: context.exports, calls };
}

for (const [path, method, rpc] of [
  ["../lib/data/trades.ts", "listTradeOffers", "list_trade_offers"],
  ["../lib/data/market.ts", "getAuctions", "list_auctions"]
]) {
  const rows = Array.from({ length: 251 }, (_, i) => ({
    id: `item-${i}`,
    offeredCards: [],
    requestedCards: [],
    card: { id: `card-${i}` },
    endsAt: new Date(1800000000000 + (251 - i) * 1000).toISOString()
  }));
  test(`${rpc}: every page is loaded and original player order is retained`, async () => {
    const { api, calls } = setup(path, async (name, args) => {
      if (name === rpc) return { data: rows, error: null };
      assert.equal(name, `${rpc}_page`);
      const offset = args.p_cursor ? Number(args.p_cursor.id) : 0;
      return {
        data: {
          items: rows.slice(offset, offset + 100),
          nextCursor:
            offset + 100 < rows.length ? { id: String(offset + 100) } : null
        },
        error: null
      };
    });
    const result = await api[method]();
    const expected =
      method === "getAuctions"
        ? [...rows].sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))
        : rows;
    assert.deepEqual(
      Array.from(result, row => row.id),
      expected.map(row => row.id)
    );
    assert.equal(calls.length, 3);
    assert.ok(
      calls.every(
        call => call.name === `${rpc}_page` && call.args.p_limit === 100
      )
    );
  });
  test(`${rpc}: old database falls back only for a missing first-page RPC`, async () => {
    const { api, calls } = setup(path, async name =>
      name === `${rpc}_page`
        ? { data: null, error: { code: "PGRST202", message: "missing" } }
        : { data: [], error: null }
    );
    assert.equal((await api[method]()).length, 0);
    assert.deepEqual(
      calls.map(call => call.name),
      [`${rpc}_page`, rpc]
    );
    for (const code of ["42501", "P0001"]) {
      const denied = setup(path, async () => ({
        data: null,
        error: { code, message: "denied" }
      }));
      await assert.rejects(denied.api[method]());
      assert.equal(denied.calls.length, 1);
    }
  });
  test(`${rpc}: errors after a partial page never show a truncated list or trigger legacy fallback`, async () => {
    const { api, calls } = setup(path, async (_name, args) =>
      args?.p_cursor
        ? { data: null, error: { code: "PGRST202", message: "missing" } }
        : {
            data: { items: rows.slice(0, 100), nextCursor: { id: "100" } },
            error: null
          }
    );
    await assert.rejects(api[method]());
    assert.equal(calls.length, 2);
  });
}
