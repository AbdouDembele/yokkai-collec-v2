import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { readRpcPages } from "../lib/data/rpc-pages.mjs";

function load(relativePath, { results = {}, failures = {} } = {}) {
  const invalidations = [];
  const calls = [];
  const order = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    order.push("rpc:" + name);
    if (failures[name])
      return { data: null, error: { message: failures[name] } };
    return { data: results[name] ?? null, error: null };
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
      if (name === "@/lib/data/rpc-pages.mjs") return { readRpcPages };
      if (name === "@/utils/supabase/client")
        return { createClient: () => ({ rpc }) };
      if (name === "@/lib/data/cards")
        return {
          invalidatePlayerSnapshots: scopes => {
            invalidations.push([...scopes]);
            order.push("invalidate:" + scopes.join(","));
          },
          withLiveCardFranchises: async cards => cards
        };
      assert.fail("Import inattendu: " + name);
    }
  };
  const source = ts.transpileModule(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText;
  vm.runInNewContext(source, context);
  return { api: context.exports, invalidations, calls, order };
}

test("mise en vente : la Collection est invalidée avant la résolution", async () => {
  const proof = load("../lib/data/market.ts", {
    results: { create_auction: "auction-1" }
  });
  assert.equal(await proof.api.createAuction("card-1", 10, 60), "auction-1");
  assert.deepEqual(proof.invalidations, [["collection"]]);
  assert.deepEqual(proof.order, [
    "rpc:create_auction",
    "invalidate:collection"
  ]);
});

test("mise : seul le solde est invalidé après succès", async () => {
  const proof = load("../lib/data/market.ts", {
    results: { place_bid: { currentPrice: 20, endsAt: "later", balance: 480 } }
  });
  assert.equal((await proof.api.placeBid("auction-1", 20)).balance, 480);
  assert.deepEqual(proof.invalidations, [["balance"]]);
});

test("retrait d'une vente : la Collection est invalidée après succès", async () => {
  const proof = load("../lib/data/market.ts", {
    results: { cancel_auction: true }
  });
  await proof.api.cancelAuction("auction-1");
  assert.deepEqual(proof.invalidations, [["collection"]]);
  assert.deepEqual(proof.order, [
    "rpc:cancel_auction",
    "invalidate:collection"
  ]);
});

test("échange : seule une acceptation effective invalide Collection et solde", async () => {
  const accepted = load("../lib/data/trades.ts", {
    results: { respond_trade_offer: true }
  });
  assert.equal(await accepted.api.respondTradeOffer("trade-1", "accept"), true);
  assert.deepEqual(accepted.invalidations, [["collection", "balance"]]);
  const declined = load("../lib/data/trades.ts", {
    results: { respond_trade_offer: true }
  });
  await declined.api.respondTradeOffer("trade-1", "decline");
  assert.deepEqual(declined.invalidations, []);
  const stale = load("../lib/data/trades.ts", {
    results: { respond_trade_offer: false }
  });
  await stale.api.respondTradeOffer("trade-1", "accept");
  assert.deepEqual(stale.invalidations, []);
  const cancelled = load("../lib/data/trades.ts", {
    results: { cancel_trade_offer: true }
  });
  assert.equal(await cancelled.api.cancelTradeOffer("trade-1"), true);
  assert.deepEqual(cancelled.invalidations, []);
  const alreadyCancelled = load("../lib/data/trades.ts", {
    failures: { cancel_trade_offer: "TRADE_ALREADY_CANCELLED" }
  });
  assert.equal(await alreadyCancelled.api.cancelTradeOffer("trade-1"), true);
  assert.deepEqual(alreadyCancelled.invalidations, []);
});

test("succès : le résultat exact est conservé et le solde invalidé", async () => {
  const result = {
    balance: 600,
    claimedAt: "2026-09-30T00:00:00Z",
    reward: 100
  };
  const proof = load("../lib/data/achievements.ts", {
    results: { claim_achievement: result }
  });
  assert.deepEqual(await proof.api.claimAchievement("first"), result);
  assert.deepEqual(proof.invalidations, [["balance"]]);
});

test("aucune mutation en erreur ne publie d'invalidation", async () => {
  for (const [file, method, args, rpc] of [
    [
      "../lib/data/market.ts",
      "createAuction",
      ["card-1", 10, 60],
      "create_auction"
    ],
    ["../lib/data/market.ts", "placeBid", ["auction-1", 20], "place_bid"],
    ["../lib/data/market.ts", "cancelAuction", ["auction-1"], "cancel_auction"],
    [
      "../lib/data/trades.ts",
      "respondTradeOffer",
      ["trade-1", "accept"],
      "respond_trade_offer"
    ],
    [
      "../lib/data/achievements.ts",
      "claimAchievement",
      ["first"],
      "claim_achievement"
    ]
  ]) {
    const proof = load(file, { failures: { [rpc]: "AUTH_REQUIRED" } });
    await assert.rejects(proof.api[method](...args));
    assert.deepEqual(proof.invalidations, []);
  }
});

test("les consommateurs réconcilient les seules portées utiles sans toucher au reveal", () => {
  const game = readFileSync(
    new URL("../components/game.tsx", import.meta.url),
    "utf8"
  );
  const community = readFileSync(
    new URL("../components/community-views.tsx", import.meta.url),
    "utf8"
  );
  const achievements = readFileSync(
    new URL("../components/achievements.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(game),
    normalizeWhitespace(/subscribePlayerSnapshotInvalidation\(scopes =>/)
  );
  assert.match(
    normalizeWhitespace(game),
    normalizeWhitespace(/scopes\.includes\("balance"\).*getGameInfo/s)
  );
  assert.match(
    normalizeWhitespace(game),
    normalizeWhitespace(/scopes\.includes\("collection"\).*getUserCollection/s)
  );
  const subscriptionStart = game.lastIndexOf(
    "subscribePlayerSnapshotInvalidation"
  );
  const subscription = game.slice(subscriptionStart, subscriptionStart + 500);
  assert.doesNotMatch(
    normalizeWhitespace(subscription),
    normalizeWhitespace(/setDraw|setRevealed|setStatus|setDecisionStatus/)
  );
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(/subscribePlayerSnapshotInvalidation/)
  );
  assert.match(
    normalizeWhitespace(community),
    normalizeWhitespace(/screen==="profile"&&isMe/)
  );
  assert.match(
    normalizeWhitespace(achievements),
    normalizeWhitespace(/subscribePlayerSnapshotInvalidation/)
  );
  assert.match(
    normalizeWhitespace(achievements),
    normalizeWhitespace(/setBalance\(result\.balance\)/)
  );
});
