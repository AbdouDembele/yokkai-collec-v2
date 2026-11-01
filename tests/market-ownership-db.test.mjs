import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("market ownership counts only the viewer's exact variants, including locked and listed copies", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const seller = "da100000-0000-4000-8000-000000000001";
  const viewer = "da100000-0000-4000-8000-000000000002";
  const stranger = "da100000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [seller, "MarketSeller"],
    [viewer, "MarketViewer"],
    [stranger, "MarketStranger"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  const card = async source =>
    (
      await db.query(
        "insert into public.cards(source,source_id,nom,categorie,rarete_base,image_url) values('test',$1,$1,'ANIME/MANGA','SSR','https://example.test/owned.png') returning id",
        [source]
      )
    ).rows[0].id;
  const known = await card("market-owned");
  const unknown = await card("market-unowned");
  const copy = async (
    owner,
    cardId = known,
    shiny = false,
    evolved = false,
    locked = false
  ) =>
    (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved,is_locked) values($1,$2,'SSR',$3,$4,$5) returning id",
        [owner, cardId, shiny, evolved, locked]
      )
    ).rows[0].id;
  let sequence = 0;
  const auction = async (instance, owner = seller) =>
    (
      await db.query(
        "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at) values($1,$2,10,10,60,now()+interval '1 hour'+$3*interval '1 second') returning id",
        [instance, owner, sequence++]
      )
    ).rows[0].id;
  const normal = await auction(await copy(seller));
  const shiny = await auction(await copy(seller, known, true));
  const evolved = await auction(await copy(seller, known, true, true));
  const unowned = await auction(await copy(seller, unknown));
  const removable = await copy(viewer);
  await copy(viewer, known, false, false, true);
  await auction(await copy(viewer), viewer);
  await copy(viewer, known, true);
  await copy(viewer, known, true, false, true);
  await copy(viewer, known, true, true);
  await copy(stranger, unknown);
  const browse = async (user, limit = 100) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query("select public.browse_auctions_page($1) value", [limit])
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const page = await browse(viewer);
  const byId = new Map(page.items.map(item => [item.id, item]));
  assert.equal(byId.get(normal).ownedCount, 3);
  assert.equal(byId.get(shiny).ownedCount, 2);
  assert.equal(byId.get(evolved).ownedCount, 1);
  assert.equal(byId.get(evolved).card.isEvolved, true);
  assert.equal(byId.get(unowned).ownedCount, 0);
  assert.deepEqual(
    page.items
      .filter(item => item.card.id === known && !item.card.shiny)
      .map(item => item.ownedCount),
    [3, 3]
  );
  const prefix = await browse(viewer, 1);
  assert.equal(prefix.hasMore, true);
  assert.deepEqual(prefix.items, page.items.slice(0, 1));
  const other = new Map(
    (await browse(stranger)).items.map(item => [item.id, item.ownedCount])
  );
  assert.equal(other.get(normal), 0);
  assert.equal(other.get(shiny), 0);
  assert.equal(other.get(unowned), 1);
  // Snapshot-only history must retain the exact Evolved variant as well.
  await db.query(
    "update public.auctions set card_snapshot=$2,card_instance_id=null where id=$1",
    [
      evolved,
      JSON.stringify({
        id: known,
        name: "Snapshot",
        category: "ANIME/MANGA",
        rarity: "SSR",
        shiny: true,
        isEvolved: true,
        image: "https://example.test/owned.png"
      })
    ]
  );
  assert.equal(
    (await browse(viewer)).items.find(item => item.id === evolved).ownedCount,
    1
  );
  await db.query("delete from public.user_cards where id=$1", [removable]);
  assert.equal(
    (await browse(viewer)).items.find(item => item.id === normal).ownedCount,
    2
  );
  await assert.rejects(browse(""), /AUTH_REQUIRED/);
  assert.deepEqual(
    (
      await db.query(
        "select has_function_privilege('anon','public.browse_auctions_page(integer,text,text,text,text,text)','execute') anon,has_function_privilege('authenticated','public.browse_auctions_page(integer,text,text,text,text,text)','execute') player"
      )
    ).rows[0],
    { anon: false, player: true }
  );
});
