import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const alice = "10000000-0000-4000-8000-000000000011";
const bob = "10000000-0000-4000-8000-000000000012";

test("le marché filtre plusieurs raretés via un tableau JSON, une seule reste compatible", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [alice, "MultiRarityAlice"],
    [bob, "MultiRarityBob"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  for (const [index, rarity] of ["LR", "SR", "C"].entries()) {
    const card = (
      await db.query(
        `insert into public.cards(source_id,nom,franchise,categorie,rarete_base,image_url,source)
        values ($1,$2,'Multi','Anime/Manga',$3,'https://example.test/card.png','test') returning id`,
        [`market-multi-${index}`, `Multi ${rarity}`, rarity]
      )
    ).rows[0].id;
    const copy = (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'C') returning id",
        [bob, card]
      )
    ).rows[0].id;
    await db.query(
      `insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at,status)
      values ($1,$2,10,10,15,'2030-01-01T00:00:00Z','active')`,
      [copy, bob]
    );
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  const rarities = async rarity =>
    (
      await db.query(
        "select public.browse_auctions_page(100,'',$1,'','end','active') as value",
        [rarity]
      )
    ).rows[0].value.items
      .map(item => item.card.rarity)
      .sort();
  assert.deepEqual(await rarities(""), ["C", "LR", "SR"]);
  assert.deepEqual(await rarities("SR"), ["SR"]);
  assert.deepEqual(await rarities('["SR","LR"]'), ["LR", "SR"]);
  assert.deepEqual(await rarities('["sr"]'), ["SR"]);
});
