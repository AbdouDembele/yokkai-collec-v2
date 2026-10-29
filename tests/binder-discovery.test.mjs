import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "next-intl";
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      exports,
      URLSearchParams,
      Map,
      Math,
      Promise,
      require: name =>
        name === "@/lib/data/cards"
          ? {}
          : name === "@/lib/data/binders"
            ? {}
            : load(name.slice(2) + ".ts")
    }
  );
  return exports;
}
const { binderHref, binderHighlights, binderCover } = load(
  "lib/ui/binder-discovery.ts"
);
const { getHomeBinders, getPackBinderGains } = load(
  "lib/data/binder-discovery.ts"
);
const album = (key, owned, total, favorite = false) => ({
  binderKey: key,
  license: "Shared title",
  owned,
  total,
  percent: Math.round((owned * 100) / total),
  favorite
});
const card = (id, key) => ({
  id,
  name: id,
  image: "/" + id + ".png",
  category: "ANIME/MANGA",
  anime: "Shared title",
  rarity: "SSR",
  binders: [{ key, name: "Shared title", origin: "series" }]
});
test("home prioritizes favorites, then incomplete closest to completion without mutating the source", () => {
  const input = [
    album("near", 19, 20),
    album("complete", 20, 20),
    album("favorite", 1, 20, true),
    album("empty", 0, 20),
    album("half", 10, 20)
  ];
  assert.equal(
    Array.from(binderHighlights(input))
      .map(x => x.binderKey)
      .join(","),
    "favorite,near,half"
  );
  assert.equal(input[0].binderKey, "near");
  assert.equal(binderHighlights([album("zero", 0, 0, true)]).length, 0);
});
test("binder links and covers distinguish same-name series and source binders", () => {
  const a = album("series:1", 1, 2),
    b = album("source:2", 1, 2);
  assert.notEqual(binderHref(a), binderHref(b));
  const url = new URL(binderHref(a), "https://example.test");
  assert.equal(url.pathname, "/collection");
  assert.equal(url.searchParams.get("view"), "binders");
  assert.equal(url.searchParams.get("binder"), "series:1");
  assert.equal(
    binderCover(a, [card("wrong", "source:2"), card("right", "series:1")]),
    "/right.png"
  );
  assert.equal(binderCover(b, [card("right", "series:1")]), undefined);
});
test("home uses one bounded album read and at most three cover reads; a failed cover preserves progress", async () => {
  let reads = 0,
    covers = 0;
  const adapter = {
    stable: () => true,
    enrich: async c => c,
    albums: async opts => {
      reads++;
      assert.equal(opts.pageSize, 72);
      return {
        items: Array.from({ length: 10 }, (_, i) =>
          album("series:" + i, i + 1, 20)
        ),
        total: 10
      };
    },
    cards: async opts => {
      covers++;
      assert.equal(opts.pageSize, 1);
      assert.equal(opts.ownedOnly, true);
      if (covers === 1) throw Error("Media unavailable");
      return { items: [card("cover", opts.license)], total: 20 };
    }
  };
  const result = await getHomeBinders(adapter);
  assert.equal(reads, 1);
  assert.equal(covers, 3);
  assert.equal(result.length, 3);
  assert.equal(result[0].owned, 10);
  assert.equal(result[0].image, undefined);
});
test("pack progress deduplicates card IDs, preserves multiple memberships and uses authoritative distinct totals", async () => {
  let enrich = 0,
    reads = 0;
  const cards = [card("new", "series:1"), card("new", "series:1")];
  cards[0].binders.push({
    key: "source:2",
    name: "Source title",
    origin: "source"
  });
  const gains = await getPackBinderGains(cards, {
    stable: () => true,
    enrich: async values => {
      enrich++;
      assert.equal(values.length, 1);
      return [cards[0]];
    },
    albums: async () => {
      throw Error("Must not reload albums");
    },
    cards: async opts => {
      reads++;
      return { items: [], total: 20, binderTotal: 24, binderOwned: 18 };
    }
  });
  assert.equal(enrich, 1);
  assert.equal(reads, 2);
  assert.equal(gains.length, 2);
  for (const gain of gains) {
    assert.equal(gain.added, 1);
    assert.equal(gain.owned, 18);
    assert.equal(gain.total, 24);
    assert.equal(gain.cardIds.join(), "new");
  }
});
test("pack enrichment is optional, empty/unknown memberships do not invent progress and large openings stay bounded", async () => {
  let reads = 0;
  const adapter = {
    stable: () => true,
    enrich: async c => c,
    albums: async () => {
      throw Error("Unexpected");
    },
    cards: async () => {
      reads++;
      return { items: [], total: 1, binderTotal: 3, binderOwned: 2 };
    }
  };
  assert.equal((await getPackBinderGains([], adapter)).length, 0);
  assert.equal(
    (
      await getPackBinderGains(
        [{ ...card("unknown", "unused"), binders: undefined }],
        adapter
      )
    ).length,
    0
  );
  const gains = await getPackBinderGains(
    Array.from({ length: 50 }, (_, i) => card(String(i), "series:" + i)),
    adapter
  );
  assert.equal(reads, 6);
  assert.equal(gains.length, 6);
  const unavailable = await getPackBinderGains([card("new", "series:1")], {
    ...adapter,
    cards: async () => {
      throw Error("Offline");
    }
  });
  assert.equal(unavailable.length, 0);
});
test("legacy progress resolves the exact license rather than a fuzzy search neighbor", async () => {
  const gains = await getPackBinderGains([card("new", "series:1")], {
    stable: () => false,
    enrich: async c => c,
    cards: async () => ({ items: [], total: 1 }),
    albums: async () => ({
      items: [
        { license: "Shared title extra", total: 100, owned: 90 },
        { license: "Shared title", total: 24, owned: 18 }
      ],
      total: 2
    })
  });
  assert.equal(gains.length, 1);
  assert.equal(gains[0].owned, 18);
  assert.equal(gains[0].total, 24);
});
test("new binder interface copy resolves in EN/FR with proper plurals", () => {
  for (const locale of ["en", "fr"]) {
    const messages = JSON.parse(
      readFileSync("messages/" + locale + ".json", "utf8")
    );
    const t = createTranslator({
      locale,
      messages,
      namespace: "binderDiscovery"
    });
    assert.equal(
      t("count", { owned: 1, total: 1 }),
      locale === "fr" ? "1 / 1 carte" : "1 / 1 card"
    );
    assert.equal(
      t("newForBinder", { count: 2 }),
      locale === "fr"
        ? "2 nouvelles cartes dans ce classeur"
        : "2 new cards in this binder"
    );
    assert(!t("missing", { count: 0 }).includes("binderDiscovery"));
  }
});
