import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("market ranks real distinct interest and puts personal follows before pagination", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const people = Array.from(
    { length: 5 },
    (_, n) => `90000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`
  );
  const [seller, alice, bob, carol, viewer] = people;
  for (const [index, id] of people.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `Interest${index}` })]
    );
  const cards = [];
  for (const [index, favorites] of [999999, 0].entries())
    cards.push(
      (
        await db.query(
          `insert into public.cards(source_id,nom,franchise,categorie,rarete_base,image_url,source,favoris_count)
       values ($1,$2,'Interest series','Anime/Manga','SR','https://example.test/card.png','test',$3) returning id`,
          [`interest-${index}`, `Interest card ${index}`, favorites]
        )
      ).rows[0].id
    );
  let expirySequence = 0;
  const fixtureClock = Date.now();
  async function auction(card = 1, minutes = 60, amount = 10) {
    const copy = (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SR') returning id",
        [seller, cards[card]]
      )
    ).rows[0].id;
    return (
      await db.query(
        `insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at)
       values ($1,$2,10,$3,60,to_timestamp($4::double precision / 1000)) returning id`,
        [
          copy,
          seller,
          amount,
          fixtureClock + minutes * 60000 + expirySequence++
        ]
      )
    ).rows[0].id;
  }
  const imported = await auction(0, 15, 10);
  const popular = await auction(1, 30, 20);
  const sameCard = await auction(1, 45, 30);
  const followed = await auction(1, 60, 100);
  for (let n = 0; n < 20; n++)
    await db.query(
      "insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,$3)",
      [popular, alice, 20 + n * 10]
    );
  for (const id of [alice, bob, seller])
    await db.query(
      "insert into public.auction_watchers(auction_id,user_id) values ($1,$2)",
      [popular, id]
    );
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,10)",
    [sameCard, carol]
  );
  // Historical deleted accounts and seller activity cannot boost a listing.
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount) values ($1,null,10),($1,$2,20)",
    [imported, seller]
  );
  await db.query(
    "insert into public.auction_watchers(auction_id,user_id) values ($1,$2),($3,$4)",
    [followed, viewer, imported, seller]
  );

  async function asPlayer(id) {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  }
  async function browse(sort = "popular", limit = 1000, query = "") {
    return (
      await db.query(
        "select public.browse_auctions_page($1,$2,'','','' || $3,'active') value",
        [limit, query, sort]
      )
    ).rows[0].value;
  }
  await asPlayer(viewer);
  const initial = await browse();
  assert.deepEqual(
    initial.items.map(a => a.id),
    [followed, popular, sameCard, imported]
  );
  assert.deepEqual(
    Object.fromEntries(initial.items.map(a => [a.id, a.popularity])),
    {
      [imported]: 0,
      [popular]: 2,
      [sameCard]: 1,
      [followed]: 1
    }
  );
  for (const sort of ["end", "asc", "desc", "popular"]) {
    const full = await browse(sort);
    assert.equal(full.items[0].id, followed, `followed first for ${sort}`);
    const first = await browse(sort, 1);
    assert.deepEqual(first.items, full.items.slice(0, 1));
    assert.equal(first.hasMore, true);
  }
  assert.deepEqual(
    (await browse("popular", 1000, "card 0")).items.map(a => a.id),
    [imported],
    "following never bypasses filters"
  );
  // Legacy full/cursor APIs expose the identical score for client fallback sorting.
  const legacy = (await db.query("select public.list_auctions() value")).rows[0]
    .value;
  const paged = (
    await db.query("select public.list_auctions_page(null,100) value")
  ).rows[0].value.items;
  for (const list of [legacy, paged])
    assert.deepEqual(
      Object.fromEntries(list.map(a => [a.id, a.popularity])),
      Object.fromEntries(initial.items.map(a => [a.id, a.popularity]))
    );
  await asPlayer(carol);
  assert.deepEqual(
    (await browse()).items.map(a => a.id),
    [popular, sameCard, followed, imported],
    "other players do not inherit the viewer's pins"
  );

  await db.exec("reset role");
  await db.query(
    "delete from public.auction_watchers where auction_id=$1 and user_id=$2",
    [popular, bob]
  );
  await asPlayer(viewer);
  assert.equal(
    (await browse()).items.find(a => a.id === popular).popularity,
    1,
    "unwatching removes interest immediately"
  );
  await db.exec("reset role");
  await db.query(
    "delete from public.auction_watchers where auction_id=$1 and user_id=$2",
    [popular, alice]
  );
  await asPlayer(viewer);
  assert.equal(
    (await browse()).items.find(a => a.id === popular).popularity,
    1,
    "a bidder is still counted after unwatching"
  );
  await db.exec("reset role");
  await db.query(
    "delete from public.auction_watchers where auction_id=$1 and user_id=$2",
    [followed, viewer]
  );
  await asPlayer(viewer);
  assert.deepEqual(
    (await browse()).items.map(a => a.id),
    [popular, sameCard, imported, followed],
    "ties use ending time and unwatching removes priority"
  );
  // A watched listing beyond the first 100 by time/price must enter the prefix.
  await db.exec("reset role");
  for (let n = 0; n < 101; n++) await auction(0, 15, 10);
  await db.query(
    "insert into public.auction_watchers(auction_id,user_id) values ($1,$2)",
    [followed, viewer]
  );
  await asPlayer(viewer);
  const hundred = await browse("end", 100);
  assert.equal(hundred.items.length, 100);
  assert.equal(hundred.items[0].id, followed);
  assert.equal(hundred.hasMore, true);
  const prefixes = await browse("end", 101);
  assert.deepEqual(hundred.items, prefixes.items.slice(0, 100));
  assert.equal(new Set(prefixes.items.map(a => a.id)).size, 101);
  for (const item of prefixes.items) {
    assert.equal(
      Object.hasOwn(item, "watchers"),
      false,
      "watcher identities remain private"
    );
    assert.equal(Object.hasOwn(item, "bidderIds"), false);
  }
  await db.exec("reset role; set role anon");
  await assert.rejects(browse(), { code: "42501" });
});

test("client watch priority preserves every selected sort inside both groups", () => {
  const source = readFileSync(
    new URL("../components/community-views.tsx", import.meta.url),
    "utf8"
  );
  const ast = ts.createSourceFile(
    "market.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const fn = ast.statements.find(
    n => ts.isFunctionDeclaration(n) && n.name?.text === "compareMarketAuctions"
  );
  assert.ok(fn);
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fn.getText(ast), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    { exports }
  );
  const compare = exports.compareMarketAuctions;
  const item = (id, wishlist, amount, popularity, remainingSeconds) => ({
    id,
    wishlist,
    amount,
    popularity,
    remainingSeconds,
    endsAt: "2030-01-01"
  });
  const values = [
    item("a", false, 10, 50, 10),
    item("b", true, 30, 1, 40),
    item("c", true, 20, 2, 30),
    item("d", false, 40, 10, 20)
  ];
  for (const [sort, ids] of Object.entries({
    end: ["c", "b", "a", "d"],
    asc: ["c", "b", "a", "d"],
    desc: ["b", "c", "d", "a"],
    popular: ["c", "b", "a", "d"]
  }))
    assert.deepEqual(
      values.toSorted((a, b) => compare(a, b, sort)).map(a => a.id),
      ids
    );
});
