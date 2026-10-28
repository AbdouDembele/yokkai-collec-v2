import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

function setup() {
  let now = 0,
    fail = false;
  const calls = [],
    rpcCalls = [];
  const compile = path =>
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }).outputText;
  const state = {
    exports: {},
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    BroadcastChannel: undefined
  };
  vm.runInNewContext(compile("../lib/data/player-state.ts"), state);
  const client = {
    auth: { onAuthStateChange() {} },
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({
        data: {
          items: [
            {
              id: "hidden-license",
              name: "Card",
              category: "Anime",
              anime: "Primary",
              rarity: "C",
              image: "https://example.test/card"
            }
          ],
          total: 1
        },
        error: fail ? { code: "42501" } : null
      });
    },
    from() {
      let options, from, to;
      const filters = [],
        orders = [];
      const q = {
        select(_fields, o) {
          options = o;
          return q;
        },
        or(x) {
          filters.push(x);
          return q;
        },
        eq(k, v) {
          filters.push([k, v]);
          return q;
        },
        order(k, options) {
          orders.push([k, options?.ascending ?? true]);
          return q;
        },
        range(a, b) {
          from = a;
          to = b;
          return q;
        },
        then(resolve) {
          calls.push({ count: options?.count, filters, orders, from, to });
          return Promise.resolve({
            data: [
              {
                id: String(from),
                nom: "Card",
                categorie: "Anime",
                rarete_base: "C",
                image_url: "https://example.test/card"
              }
            ],
            count: options?.count ? 251 : null,
            error: fail ? { code: "42501" } : null
          }).then(resolve);
        }
      };
      return q;
    }
  };
  const context = {
    exports: {},
    require: n => {
      if (n === "@/lib/data/read-request") return {};
      if (n === "@/lib/data/player-state") return state.exports;
      if (n === "@/utils/supabase/client")
        return { createClient: () => client };
      if (n === "@/lib/ui/card-search")
        return {
          cardSearchTerms: q =>
            q.trim().toLowerCase().split(/\s+/).filter(Boolean)
        };
      assert.fail(n);
    }
  };
  vm.runInNewContext(compile("../lib/data/cards.ts"), context);
  return {
    api: context.exports,
    calls,
    rpcCalls,
    tick: n => {
      now += n;
    },
    fail: v => {
      fail = v;
    }
  };
}

test("catalogue keeps exact totals and fresh page rows while reusing counts only for identical filters", async () => {
  const s = setup();
  for (let page = 1; page <= 3; page++) {
    const result = await s.api.getCataloguePage({ page });
    assert.equal(result.total, 251);
    assert.equal(result.cards[0].id, String((page - 1) * 24));
  }
  assert.equal(s.calls.length, 3);
  assert.equal(s.calls.filter(c => c.count === "exact").length, 1);
  for (const call of s.calls)
    assert.deepEqual(call.orders, [
      ["rarete_base", false],
      ["nom", true],
      ["id", true]
    ]);
  await s.api.getCataloguePage({ pageSize: 48 });
  assert.equal(s.calls.at(-1).count, undefined);
  for (const filter of [{ category: "Anime" }, { rarity: "SR" }])
    await s.api.getCataloguePage(filter);
  const searched = await s.api.getCataloguePage({
    query: "Card Anime",
    category: "Anime",
    rarity: "SR",
    page: 2,
    pageSize: 24
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(s.rpcCalls[0])),
    {
      name: "get_catalogue_cards_page",
      args: {
        p_query: "card anime",
        p_category: "Anime",
        p_rarity: "SR",
        p_offset: 24,
        p_limit: 24,
        p_sort: "rarity"
      }
    },
    "normalized terms and pagination are delegated to the indexed catalogue RPC"
  );
  assert.equal(searched.cards[0].anime, "Primary");
  assert.equal(s.calls.filter(c => c.count === "exact").length, 3);
  s.tick(30001);
  await s.api.getCataloguePage();
  assert.equal(s.calls.at(-1).count, "exact");
  s.fail(true);
  await assert.rejects(s.api.getCataloguePage({ query: "retry" }));
  s.fail(false);
  await s.api.getCataloguePage({ query: "retry" });
  assert.equal(s.rpcCalls.at(-1).args.p_query, "retry");
});

test("catalogue substring searches use trigram indexes without changing results", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const indexes = (
    await db.query(
      "select indexdef from pg_indexes where schemaname='public' and tablename='cards'"
    )
  ).rows;
  for (const column of ["nom", "franchise"])
    assert.ok(
      indexes.some(i =>
        i.indexdef.includes(`(${column} extensions.gin_trgm_ops)`)
      )
    );
  await db.exec(`insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select 'perf-'||i,case when i%1000=0 then 'UniqueNeedle '||i else 'Ordinary '||i end,'Anime/Manga','Series '||i,'C','https://example.test/card','test' from generate_series(1,20000)i;
    analyze public.cards;`);
  await db.exec("vacuum analyze public.cards");
  const sql =
    "select id,nom from public.cards where nom ilike '%UniqueNeedle%' or franchise ilike '%UniqueNeedle%' order by nom,id";
  await db.exec("set enable_bitmapscan=off;set enable_indexscan=off");
  const baseline = (await db.query(`explain (analyze,format json) ${sql}`))
    .rows[0]["QUERY PLAN"];
  const before = (await db.query(sql)).rows;
  await db.exec("reset enable_bitmapscan;reset enable_indexscan");
  const plan = (await db.query(`explain (analyze,format json) ${sql}`)).rows[0][
    "QUERY PLAN"
  ];
  assert.match(JSON.stringify(plan), /cards_(nom|franchise)_trgm/);
  assert.deepEqual((await db.query(sql)).rows, before);
  assert.equal(before.length, 20);
  t.diagnostic(
    `20,000 cards: sequential ${baseline[0]["Execution Time"]} ms -> indexed ${plan[0]["Execution Time"]} ms; identical 20 results`
  );
});

test("catalogue search finds hidden secondary licenses without exposing them on cards", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  await db.exec(`
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values
      ('catalogue-hidden-1','Hidden Hero','ANIME/MANGA','Primary Saga','SR','https://example.test/hidden-1.png','test'),
      ('catalogue-hidden-2','Hidden Rival','FILM','Other Primary','R','https://example.test/hidden-2.png','test');
    insert into public.card_franchises(card_id,franchise,position)
    select id,'Secret Crossover',1 from public.cards where source_id like 'catalogue-hidden-%';
  `);

  const result = (
    await db.query(
      "select public.get_catalogue_cards_page('hidden secret','ANIME/MANGA','SR',0,24) as value"
    )
  ).rows[0].value;
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.deepEqual(
    {
      name: result.items[0].name,
      anime: result.items[0].anime,
      category: result.items[0].category,
      rarity: result.items[0].rarity
    },
    {
      name: "HIDDEN HERO",
      anime: "Primary Saga",
      category: "ANIME/MANGA",
      rarity: "SR"
    },
    "the hidden license is searchable while only the primary license is returned"
  );

  const indexes = (
    await db.query(
      "select indexdef from pg_indexes where schemaname='public' and indexname='card_franchises_name_trgm_idx'"
    )
  ).rows;
  assert.match(indexes[0].indexdef, /gin_trgm_ops/);
});
