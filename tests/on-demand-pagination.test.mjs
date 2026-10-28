import assert from "node:assert/strict";
import test from "node:test";
import { readRpcPages } from "../lib/data/rpc-pages.mjs";

for (const name of ["list_auctions", "list_trade_offers", "get_friendships"]) {
  test(
    name + ": demand loading stops after one page and resumes without loss",
    async () => {
      const rows = Array.from({ length: 251 }, (_, id) => ({ id }));
      let calls = 0;
      const rpc = async (_name, args) => {
        calls++;
        const offset = args.p_cursor?.offset ?? 0;
        return {
          data: {
            items: rows.slice(offset, offset + 100),
            nextCursor:
              offset + 100 < rows.length ? { offset: offset + 100 } : null
          },
          error: null
        };
      };
      const first = await readRpcPages(rpc, name, { maxPages: 1 });
      assert.equal(calls, 1, "opening a screen must not drain all RPC pages");
      assert.deepEqual(first.data, rows.slice(0, 100));
      const second = await readRpcPages(rpc, name, {
        maxPages: 1,
        cursor: first.nextCursor
      });
      const third = await readRpcPages(rpc, name, {
        maxPages: 1,
        cursor: second.nextCursor
      });
      assert.deepEqual([...first.data, ...second.data, ...third.data], rows);
      assert.equal(third.nextCursor, null);
      assert.equal(calls, 3);
    }
  );
}

import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function loadPager() {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../lib/data/demand-pages.ts", import.meta.url),
        "utf8"
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020
        }
      }
    ).outputText,
    { exports }
  );
  return exports.createDemandPager;
}
test("requested pages refresh atomically, retain order, serialize clicks and retry failures", async () => {
  let rows = Array.from({ length: 251 }, (_, id) => ({ id: String(id) }));
  let fail = false,
    calls = 0;
  const pager = loadPager()(
    async cursor => {
      calls++;
      const offset = cursor?.offset ?? 0;
      if (fail && offset === 100) throw new Error("offline");
      return {
        items: rows.slice(offset, offset + 100),
        nextCursor: offset + 100 < rows.length ? { offset: offset + 100 } : null
      };
    },
    row => row.id
  );
  assert.equal((await pager.refresh()).items.length, 100);
  assert.equal(calls, 1);
  const [a, b] = await Promise.all([pager.more(), pager.more()]);
  assert.equal(a.items.length, 200);
  assert.equal(b.items.length, 200);
  assert.equal(calls, 2);
  rows = [{ id: "new" }, ...rows];
  const refreshed = await pager.refresh();
  assert.deepEqual(
    Array.from(refreshed.items, row => row.id),
    rows.slice(0, 200).map(row => row.id)
  );
  assert.equal(calls, 4, "polling reads two requested pages, never the third");
  fail = true;
  await assert.rejects(pager.refresh(), /offline/);
  fail = false;
  const complete = await pager.more();
  assert.deepEqual(
    Array.from(complete.items, row => row.id),
    rows.map(row => row.id)
  );
  assert.equal(complete.nextCursor, null);
  const before = calls;
  await pager.more();
  assert.equal(calls, before, "end of list makes no requests");
});
test("later-page errors never trigger a legacy fallback and cursors must advance", async () => {
  let calls = 0;
  const result = await readRpcPages(
    async () => {
      calls++;
      return { data: null, error: { code: "PGRST202", message: "missing" } };
    },
    "list_trade_offers",
    { cursor: { offset: 100 }, maxPages: 1 }
  );
  assert.equal(calls, 1);
  assert.equal(result.error.code, "PGRST202");
  const repeated = await readRpcPages(
    async () => ({
      data: { items: [], nextCursor: { offset: 100 } },
      error: null
    }),
    "get_friendships",
    { cursor: { offset: 100 }, maxPages: 1 }
  );
  assert.equal(repeated.error.code, "INVALID_PAGE_CURSOR");
});

function loadApi(file, handler) {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return handler(name, args);
    }
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../lib/data/" + file + ".ts", import.meta.url),
        "utf8"
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020
        }
      }
    ).outputText,
    {
      exports,
      process: { env: { NODE_ENV: "production" } },
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
        if (name === "@/lib/data/rpc-pages.mjs") return { readRpcPages };
        if (name === "@/lib/data/cards")
          return {
            withLiveCardFranchises: async cards => cards,
            invalidatePlayerSnapshots() {}
          };
        assert.fail(name);
      }
    }
  );
  return { api: exports, calls };
}
test("front readers fetch one friends/offers page; market sends its full filter and growing limit", async () => {
  const offers = loadApi("trades", async () => ({
    data: {
      items: [{ id: "offer", offeredCards: [], requestedCards: [] }],
      nextCursor: { id: "next" }
    },
    error: null
  }));
  assert.equal((await offers.api.listTradeOffersPage()).items.length, 1);
  assert.equal(offers.calls.length, 1);
  const friends = loadApi("friends", async () => ({
    data: {
      items: [{ bucket: "friends", friend: { id: "friend" } }],
      nextCursor: { id: "next" }
    },
    error: null
  }));
  assert.equal(
    (await friends.api.getFriendshipsPage()).items[0].friend.id,
    "friend"
  );
  assert.equal(friends.calls.length, 1);
  const market = loadApi("market", async () => ({
    data: { items: [], hasMore: true },
    error: null
  }));
  const query = {
    query: "one piece luffy",
    rarity: "SR",
    category: "Anime/Manga",
    sort: "popular",
    section: "active"
  };
  assert.equal((await market.api.browseAuctions(query, 200)).hasMore, true);
  assert.equal(market.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(market.calls[0])), {
    name: "browse_auctions_page",
    args: {
      p_limit: 200,
      p_query: query.query,
      p_rarity: "SR",
      p_category: "Anime/Manga",
      p_sort: "popular",
      p_section: "active"
    }
  });
});
test("market before migration uses the complete legacy client list; authorization never falls back", async () => {
  const rows = Array.from({ length: 251 }, (_, id) => ({
    id: String(id),
    endsAt: new Date(2000000000000 + id * 1000).toISOString(),
    card: { id: String(id) }
  }));
  const market = loadApi("market", async (name, args) => {
    if (name === "browse_auctions_page")
      return { data: null, error: { code: "PGRST202" } };
    assert.equal(name, "list_auctions_page");
    const offset = args.p_cursor?.offset ?? 0;
    return {
      data: {
        items: rows.slice(offset, offset + 100),
        nextCursor: offset + 100 < rows.length ? { offset: offset + 100 } : null
      },
      error: null
    };
  });
  const query = {
    query: "",
    rarity: "",
    category: "",
    sort: "end",
    section: "active"
  };
  const page = await market.api.browseAuctions(query);
  assert.equal(page.items.length, 251);
  assert.equal(page.hasMore, false);
  assert.equal(market.calls.length, 4);
  const denied = loadApi("market", async () => ({
    data: null,
    error: { code: "42501" }
  }));
  await assert.rejects(denied.api.browseAuctions(query));
  assert.equal(denied.calls.length, 1);
});

test("My auctions history before its migration rebuilds All, Sold and Unsold from legacy sections", async () => {
  const legacy = {
    mine: [{ id: "live", status: "active", card: { id: "a", category: "B" } }],
    won: [{ id: "won", status: "sold", card: { id: "b", category: "A" } }],
    sold: [
      { id: "sale", status: "sold", card: { id: "c", category: "A" } },
      { id: "unsold", status: "expired", card: { id: "d", category: "C" } }
    ]
  };
  const market = loadApi("market", async (name, args) => {
    assert.equal(name, "browse_auctions_page");
    if (!(args.p_section in legacy))
      return {
        data: null,
        error: { code: "P0001", message: "INVALID_MARKET_FILTER" }
      };
    return {
      data: {
        items: legacy[args.p_section],
        hasMore: args.p_section === "sold",
        categories: [
          ...new Set(legacy[args.p_section].map(a => a.card.category))
        ]
      },
      error: null
    };
  });
  const query = { query: "", rarity: "", category: "", sort: "end" };
  const all = await market.api.browseAuctions({ ...query, section: "all" });
  assert.deepEqual(
    [...all.items.map(a => a.id)],
    ["live", "won", "sale", "unsold"]
  );
  assert.equal(all.hasMore, true);
  assert.deepEqual([...all.categories], ["A", "B", "C"]);
  for (const [section, ids] of [
    ["sales", ["sale"]],
    ["unsold", ["unsold"]]
  ])
    assert.deepEqual(
      [
        ...(await market.api.browseAuctions({ ...query, section })).items.map(
          a => a.id
        )
      ],
      ids
    );
  // Legacy sections never retry: other errors keep failing.
  const denied = loadApi("market", async () => ({
    data: null,
    error: { code: "P0001", message: "INVALID_MARKET_FILTER" }
  }));
  await assert.rejects(denied.api.browseAuctions({ ...query, section: "won" }));
});

test("Load more during polling waits for the refreshed cursor and coalesces repeated clicks", async () => {
  let release,
    calls = 0;
  const rows = Array.from({ length: 251 }, (_, id) => ({ id: String(id) }));
  const pager = loadPager()(
    async cursor => {
      calls++;
      const offset = cursor?.offset ?? 0;
      if (calls === 2)
        await new Promise(resolve => {
          release = resolve;
        });
      return {
        items: rows.slice(offset, offset + 100),
        nextCursor: offset + 100 < rows.length ? { offset: offset + 100 } : null
      };
    },
    row => row.id
  );
  await pager.refresh();
  const poll = pager.refresh();
  const more = pager.more(),
    duplicate = pager.more();
  release();
  await poll;
  const [a, b] = await Promise.all([more, duplicate]);
  assert.equal(a.items.length, 200);
  assert.equal(b.items.length, 200);
  assert.equal(calls, 3, "one initial read, one poll, one extra page");
});
