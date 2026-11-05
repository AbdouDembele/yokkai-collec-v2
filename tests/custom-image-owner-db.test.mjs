import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

// Product rule: a custom image belongs to the player who chose it. A card that
// changes owner (trade, auction, admin recovery) shows the catalogue image.
test("a traded card loses the previous owner's custom image; the kept card keeps its own", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column banned_until timestamptz");
  const alice = "c1a00000-0000-4000-8000-000000000001";
  const bob = "c1a00000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [alice, "ArtAlice"],
    [bob, "ArtBob"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)values('custom-owner','Custom owner','ANIME/MANGA','Art','R','https://example.test/catalogue.png','test')returning id"
    )
  ).rows[0].id;
  const insertCopy = async (owner, art) =>
    (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity,custom_image_url)values($1,$2,'R',$3)returning id",
        [owner, card, art]
      )
    ).rows[0].id;
  const traded = await insertCopy(alice, "https://i.imgur.com/alice-art.png");
  const kept = await insertCopy(alice, "https://i.imgur.com/alice-kept.png");
  const bobs = await insertCopy(bob, "https://i.imgur.com/bob-art.png");
  await db.query(
    "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')",
    [alice, bob]
  );

  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  const offer = (
    await db.query(
      "select public.create_trade_offer($1,array[$2]::uuid[],0,array[$3]::uuid[]) as id",
      [bob, traded, bobs]
    )
  ).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob]);
  assert.equal(
    (
      await db.query("select public.respond_trade_offer($1,'accept') as ok", [
        offer
      ])
    ).rows[0].ok,
    true
  );
  await db.exec("reset role");

  const rows = Object.fromEntries(
    (
      await db.query(
        "select id,user_id,custom_image_url from public.user_cards where id=any($1::uuid[])",
        [[traded, kept, bobs]]
      )
    ).rows.map(row => [row.id, row])
  );
  // Both directions of the trade: each received card shows the catalogue art.
  assert.equal(rows[traded].user_id, bob);
  assert.equal(rows[traded].custom_image_url, null);
  assert.equal(rows[bobs].user_id, alice);
  assert.equal(rows[bobs].custom_image_url, null);
  // A card that did not change owner keeps its owner's own image.
  assert.equal(rows[kept].user_id, alice);
  assert.equal(
    rows[kept].custom_image_url,
    "https://i.imgur.com/alice-kept.png"
  );

  // Any other ownership change (admin recovery, future paths) follows the rule,
  // and updates that keep the owner never touch the image.
  await db.query(
    "update public.user_cards set folder_id=null,is_locked=false where id=$1",
    [kept]
  );
  assert.equal(
    (
      await db.query(
        "select custom_image_url from public.user_cards where id=$1",
        [kept]
      )
    ).rows[0].custom_image_url,
    "https://i.imgur.com/alice-kept.png"
  );
  await db.query("update public.user_cards set user_id=$1 where id=$2", [
    bob,
    kept
  ]);
  assert.equal(
    (
      await db.query(
        "select custom_image_url from public.user_cards where id=$1",
        [kept]
      )
    ).rows[0].custom_image_url,
    null
  );
});
