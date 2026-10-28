import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

// Execute the existing client predicates, rather than reproducing them in SQL tests.
function helper(file, names, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const functions = ast.statements.filter(
    node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
  );
  assert.equal(functions.length, names.length);
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(functions.map(node => node.getText(ast)).join("\n"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }).outputText,
    { exports, ...globals }
  );
  return exports;
}
const { matchesCardSearch } = helper("../lib/ui/card-search.ts", [
  "cardSearchTerms",
  "matchesCardSearch"
]);
const { compareMarketAuctions } = helper("../components/community-views.tsx", [
  "compareMarketAuctions"
]);
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";

test("market prefix RPC preserves client search, sections and global sorting", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [alice, "BrowseAlice"],
    [bob, "BrowseBob"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  const fixtures = [
    ["Monkey D. Luffy", "One Piece", "Anime/Manga", "C", 8],
    ["Naruto Uzumaki", "Naruto", "Anime/Manga", "SR", 2],
    ["Éclair_100%", "École (Magic)", "Comics", "C", 8],
    ["Magic Hero", "One Piece", "Comics", "SR", 0]
  ];
  const cards = [];
  for (const [
    index,
    [name, anime, category, rarity, popularity]
  ] of fixtures.entries()) {
    cards.push(
      (
        await db.query(
          `insert into public.cards(source_id,nom,franchise,categorie,rarete_base,image_url,source,favoris_count)
      values ($1,$2,$3,$4,$5,'https://example.test/card.png','test',$6) returning id`,
          [`browse-${index}`, name, anime, category, rarity, popularity]
        )
      ).rows[0].id
    );
  }
  async function insertAuction(
    index,
    seller = bob,
    status = "active",
    buyer = null
  ) {
    const copy = (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'C') returning id",
        [seller, cards[index % 4]]
      )
    ).rows[0].id;
    return (
      await db.query(
        `insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at,status,buyer_id)
      values ($1,$2,10,$3,15,$4,$5,$6) returning id`,
        [
          copy,
          seller,
          10 + (index % 3) * 10,
          `2030-01-0${1 + (index % 3)}T00:00:00Z`,
          status,
          buyer
        ]
      )
    ).rows[0].id;
  }
  for (let index = 0; index < 12; index++) {
    const auction = await insertAuction(index, index % 3 === 0 ? alice : bob);
    if (index === 1)
      await db.query(
        "insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,20)",
        [auction, alice]
      );
  }
  await insertAuction(0, bob, "sold", alice);
  await insertAuction(1, alice, "sold", bob);
  await insertAuction(2, alice, "expired");
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  async function browse({
    limit = 3,
    query = "",
    rarity = "",
    category = "",
    sort = "end",
    section = "active"
  } = {}) {
    return (
      await db.query(
        "select public.browse_auctions_page($1,$2,$3,$4,$5,$6) as value",
        [limit, query, rarity, category, sort, section]
      )
    ).rows[0].value;
  }
  async function expected({
    query = "",
    rarity = "",
    category = "",
    sort = "end",
    section = "active"
  } = {}) {
    const legacy = (await db.query("select public.list_auctions() as value"))
      .rows[0].value;
    const catalogue = (await db.query("select id,franchise from public.cards"))
      .rows;
    const { withLiveCardFranchises } = helper(
      "../lib/data/cards.ts",
      ["withLiveCardFranchises"],
      {
        FRANCHISE_BATCH: 200,
        db: () => ({
          from: () => ({
            select: () => ({
              in: async () => ({ data: catalogue, error: null })
            })
          })
        })
      }
    );
    const liveCards = await withLiveCardFranchises(legacy.map(a => a.card));
    return legacy
      .map((a, index) => ({ ...a, card: liveCards[index] }))
      .filter(a =>
        section === "mine"
          ? a.status === "active" && (a.sellerId === alice || a.hasBid)
          : section === "won"
            ? a.status === "sold" && a.buyerId === alice
            : section === "sold"
              ? a.status !== "active" && a.sellerId === alice
              : section === "all"
                ? (a.status === "active" &&
                    (a.sellerId === alice || a.hasBid)) ||
                  (a.status === "sold" && a.buyerId === alice) ||
                  (a.status !== "active" && a.sellerId === alice)
                : section === "sales"
                  ? a.status === "sold" && a.sellerId === alice
                  : section === "unsold"
                    ? a.status === "expired" && a.sellerId === alice
                    : a.status === "active"
      )
      .filter(
        a =>
          matchesCardSearch(query, [a.card.name, a.card.anime]) &&
          (!rarity || a.card.rarity === rarity) &&
          (!category || a.card.category === category)
      )
      .map(a => {
        const remainingSeconds = Math.max(
          0,
          Math.ceil((Date.parse(a.endsAt) - Date.now()) / 1000)
        );
        // Same rule as presentAuction(): ended rows sort after live ones.
        return {
          ...a,
          remainingSeconds,
          finished: a.status !== "active" || remainingSeconds === 0
        };
      })
      .sort(
        (a, b) => compareMarketAuctions(a, b, sort) || a.id.localeCompare(b.id)
      );
  }
  async function assertPrefix(options = {}) {
    const all = await expected(options);
    const page = await browse(options);
    const limit = options.limit ?? 3;
    assert.deepEqual(
      page.items.map(a => a.id),
      all.slice(0, limit).map(a => a.id),
      JSON.stringify(options)
    );
    assert.equal(page.hasMore, all.length > limit);
    assert.equal(new Set(page.items.map(a => a.id)).size, page.items.length);
    return page;
  }
  await t.test(
    "SQL matches the existing client predicates on the same multilingual fixture",
    async () => {
      for (const sort of ["end", "asc", "desc", "popular"])
        for (const query of [
          "",
          "ONE piece luffy",
          "piece monkey",
          "ÉCLAIR école",
          "éclair_100%",
          "magic,(one)",
          "luffy naruto",
          "_"
        ])
          await assertPrefix({ sort, query, limit: 2 });
      for (const rarity of ["C", "SR"])
        for (const category of ["", "Comics", "Anime/Manga"])
          await assertPrefix({ rarity, category, query: "", sort: "popular" });
      for (const section of [
        "active",
        "mine",
        "won",
        "sold",
        "all",
        "sales",
        "unsold"
      ])
        await assertPrefix({ section });
      const history = await browse({ section: "all", limit: 1000 });
      assert.deepEqual(
        Object.fromEntries(
          ["mine", "won", "sold", "all", "sales", "unsold"].map(key => [
            key,
            history.counts[key]
          ])
        ),
        {
          mine: (await expected({ section: "mine" })).length,
          won: 1,
          sold: 2,
          all: (await expected({ section: "all" })).length,
          sales: 1,
          unsold: 1
        }
      );
      assert.equal(history.counts.salesKaras, 20);
      const sale = history.items.find(
        a => a.status === "sold" && a.sellerId === alice
      );
      const purchase = history.items.find(
        a => a.status === "sold" && a.buyerId === alice
      );
      assert.equal(sale.buyer, "BrowseBob");
      assert.equal(purchase.buyer, "BrowseAlice");
      assert.equal(history.items.find(a => a.status === "expired").buyer, null);
      assert.ok(
        (await browse({ section: "active", limit: 1000 })).items.every(
          a => a.buyer === null
        ),
        "Leading bidders stay anonymous on live auctions"
      );
    }
  );
  await t.test(
    "Load more and polling replace an exact prefix after creation, repricing and ending",
    async () => {
      for (const sort of ["end", "asc", "desc", "popular"]) {
        await assertPrefix({ sort, limit: 3 });
        await db.exec("reset role");
        const created = await insertAuction(0);
        await db.exec("set role authenticated");
        await assertPrefix({ sort, limit: 6 });
        const previous = await assertPrefix({ sort, limit: 3 });
        await db.exec("reset role");
        await db.query(
          "update public.auctions set current_price=1000 where id=$1",
          [previous.items[0].id]
        );
        await db.exec("set role authenticated");
        await assertPrefix({ sort, limit: 6 });
        await db.exec("reset role");
        await db.query(
          "update public.auctions set status='expired' where id=$1",
          [created]
        );
        await db.exec("set role authenticated");
        await assertPrefix({ sort, limit: 6 });
      }
      await assertPrefix({ limit: 1000 });
    }
  );
  await t.test(
    "historical snapshots search the live franchise without losing card fields",
    async () => {
      await db.exec("reset role");
      const id = await insertAuction(0, alice, "sold", bob);
      await db.query(
        "update public.auctions set card_instance_id=null,card_snapshot=$2::jsonb where id=$1",
        [
          id,
          JSON.stringify({
            id: cards[0],
            name: "Snapshot hero",
            anime: "Old Franchise",
            category: "Anime/Manga",
            rarity: "C",
            image: "snapshot.png",
            shiny: true
          })
        ]
      );
      await db.query(
        "update public.cards set franchise='New Franchise' where id=$1",
        [cards[0]]
      );
      await db.exec("set role authenticated");
      const page = await assertPrefix({
        section: "sold",
        query: "snapshot new",
        limit: 1000
      });
      assert.equal(
        page.items.find(a => a.id === id).card.anime,
        "New Franchise"
      );
      assert.equal(page.items.find(a => a.id === id).card.shiny, true);
      await assertPrefix({
        section: "sold",
        query: "snapshot old",
        limit: 1000
      });
    }
  );
  await t.test(
    "invalid limits and anonymous callers cannot bypass the RPC boundary",
    async () => {
      for (const limit of [null, 0, -1, 1001])
        await assert.rejects(browse({ limit }), /INVALID_PAGE_SIZE/);
      await db.exec("reset role");
      const signature =
        "public.browse_auctions_page(integer,text,text,text,text,text)";
      for (const role of ["public", "anon"])
        assert.equal(
          (
            await db.query(
              "select has_function_privilege($1,$2,'EXECUTE') as allowed",
              [role, signature]
            )
          ).rows[0].allowed,
          false
        );
      const meta = (
        await db.query(
          "select prosecdef,proconfig from pg_proc where oid=$1::regprocedure",
          [signature]
        )
      ).rows[0];
      assert.equal(meta.prosecdef, true);
      assert.ok(
        meta.proconfig.some(value => /^search_path=(?:\"\"|)$/.test(value))
      );
      await db.exec("set role anon");
      await assert.rejects(browse(), { code: "42501" });
    }
  );
});
