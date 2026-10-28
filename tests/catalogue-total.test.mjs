import { intl } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("catalogue total counts every matching card, not only the displayed page", async () => {
  const compile = path =>
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }).outputText;
  const state = { exports: {}, BroadcastChannel: undefined };
  vm.runInNewContext(compile("lib/data/player-state.ts"), state);
  const rows = Array.from({ length: 1251 }, (_, i) => ({
    id: String(i),
    nom: `Card ${i}`,
    categorie: i < 1000 ? "ANIME/MANGA" : "FILM",
    rarete_base: i % 2 ? "C" : "LR",
    image_url: "https://example.test/card.png"
  }));
  const context = {
    exports: {},
    require: name => {
      if (name === "@/lib/data/player-state") return state.exports;
      if (name === "@/lib/ui/card-search") return { cardSearchTerms: () => [] };
      if (name === "@/utils/supabase/client")
        return {
          createClient: () => ({
            auth: { onAuthStateChange() {} },
            from: () => {
              let matching = rows,
                options,
                from = 0,
                to = 23;
              const request = {
                select: (_fields, value) => {
                  options = value;
                  return request;
                },
                eq: (key, value) => {
                  matching = matching.filter(row => row[key] === value);
                  return request;
                },
                order: () => request,
                range: (a, b) => {
                  from = a;
                  to = b;
                  return request;
                },
                then: resolve =>
                  Promise.resolve({
                    data: matching.slice(from, to + 1),
                    count: options?.count ? matching.length : null,
                    error: null
                  }).then(resolve)
              };
              return request;
            }
          })
        };
      return {};
    }
  };
  vm.runInNewContext(compile("lib/data/cards.ts"), context);
  const read = context.exports.getCataloguePage;
  for (const [filters, total] of [
    [{}, 1251],
    [{ category: "FILM" }, 251],
    [{ rarity: "LR" }, 626],
    [{ category: "FILM", rarity: "LR" }, 126],
    [{ category: "KPOP" }, 0]
  ]) {
    const first = await read(filters);
    assert.equal(first.total, total);
    assert.equal(first.cards.length, Math.min(total, 24));
    assert.equal((await read({ ...filters, page: 2 })).total, total);
  }
});

test("catalogue result count is visible, live, and follows the query and both filters", () => {
  const source = readFileSync("components/community-views.tsx", "utf8")
    .split("export function SearchView(")[1]
    .split("export function WishlistView")[0];
  assert.match(source, /role="status" className="yk-catalogue-total"/);
  assert.match(source, /setTotal\(value\.total\)/);
  assert.match(
    source,
    /loadPage\(\{ query, category, rarity, page, pageSize \}\)/
  );
  assert.match(source, /tv\("cardCount", \{ count: total \}\)/);
  assert.equal(
    intl.useTranslations("catalogueUi")("cardCount", { count: 1000 }),
    "1,000 cards"
  );
  assert.match(source, /tv\("cardCountUnavailable"\)/);
  assert.equal(
    intl.useTranslations("catalogueUi")("cardCountUnavailable"),
    "Card count unavailable"
  );
});

test("desktop catalogue aligns its results with the filter panel, below the count", () => {
  const css = readFileSync("styles/community.css", "utf8");
  assert.match(
    css,
    /\.yk-catalogue-title ~ \.yk-collection-main\s*\{[^}]*grid-row:\s*2;/
  );
  assert.match(
    css,
    /\.yk-catalogue-title ~ \.yk-collection-main \.yk-catalogue-heading\s*\{[^}]*bottom:\s*calc\(100% \+ var\(--layout-gutter\)\)/
  );
  assert.match(
    css,
    /\.yk-catalogue-title ~ \.yk-collection-main > \.yk-empty-state\s*\{[^}]*margin-top:\s*0/
  );
});
