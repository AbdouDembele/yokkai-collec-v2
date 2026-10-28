import { gameMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path) {
  const calls = [];
  const client = {
    auth: { onAuthStateChange() {} },
    rpc(name, args) {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      const request = Promise.resolve({
        data: { items: [], total: 0 },
        error: null
      });
      request.abortSignal = () => request;
      return request;
    }
  };
  const context = {
    exports: {},
    require(name) {
      if (name === "@/i18n/game-messages") return gameMessages;
      if (name === "@/utils/supabase/client")
        return { createClient: () => client };
      if (name === "@/lib/data/read-request")
        return {
          readRequest: callback => callback(new AbortController().signal)
        };
      if (name === "@/lib/data/player-state")
        return {
          createPlayerSnapshotCache: () => ({}),
          subscribePlayerSnapshotInvalidation: () => () => {}
        };
      if (["@/lib/data/cards", "@/lib/ui/card-search"].includes(name))
        return {};
      assert.fail(`Unexpected import: ${name}`);
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

for (const friend of [false, true]) {
  test(`le chargeur ${friend ? "ami" : "personnel"} transmet la rareté et conserve les anciens appels`, async () => {
    const { api, calls } = load(
      friend ? "../lib/data/profile.ts" : "../lib/data/cards.ts"
    );
    const page = options =>
      friend
        ? api.getFriendPaniniAlbumCardsPage("owner", options)
        : api.getPaniniAlbumCardsPage(options);
    for (const rarity of ["LR", "SSR", "SR", "R", "C"]) {
      await page({
        license: "Album",
        rarity,
        page: 2,
        pageSize: 28,
        ownedOnly: true,
        query: "Nom",
        category: "ANIME/MANGA"
      });
      assert.deepEqual(calls.at(-1), {
        name: friend
          ? "get_friend_panini_album_cards_page"
          : "get_panini_album_cards_page",
        args: {
          ...(friend ? { p_friend_id: "owner" } : {}),
          p_license: "Album",
          p_query: "Nom",
          p_category: "ANIME/MANGA",
          p_owned_only: true,
          p_offset: 28,
          p_limit: 28,
          p_rarity: rarity
        }
      });
    }
    for (const rarity of [undefined, ""]) {
      await page({ license: "Album", rarity });
      assert.equal(Object.hasOwn(calls.at(-1).args, "p_rarity"), false);
    }
    await page({ license: "Album", rarity: "LR", page: -1, pageSize: 100 });
    assert.equal(calls.at(-1).args.p_offset, 0);
    assert.equal(calls.at(-1).args.p_limit, 60);
  });
}
