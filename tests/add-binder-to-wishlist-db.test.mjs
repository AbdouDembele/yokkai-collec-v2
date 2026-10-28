import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = "73000000-0000-4000-8000-000000000001";

test("a whole binder can be added to the wishlist, skipping owned and already wishlisted cards", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [player, JSON.stringify({ pseudo: "BinderWisher" })]
  );
  await db.exec(`
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values
      ('wish-a','Wish A','ANIME/MANGA','Wish album','C','https://example.test/a.png','wish-test'),
      ('wish-b','Wish B','ANIME/MANGA','Wish album','R','https://example.test/b.png','wish-test'),
      ('wish-c','Wish C','ANIME/MANGA','Wish album','SR','https://example.test/c.png','wish-test'),
      ('wish-d','Wish D','ANIME/MANGA','Wish album','LR','https://example.test/d.png','wish-test'),
      ('wish-other','Wish Other','ANIME/MANGA','Other album','C','https://example.test/e.png','wish-test');
    insert into public.user_cards(user_id,card_id,rarity)
    select '${player}',id,rarete_base from public.cards where source_id='wish-a';
    insert into public.wishlists(user_id,card_id)
    select '${player}',id from public.cards where source_id='wish-b';
  `);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  const add = async binder =>
    (
      await db.query("select public.add_binder_to_wishlist($1) as value", [
        binder
      ])
    ).rows[0].value;
  const wishlisted = async () =>
    (
      await db.query(
        "select c.source_id from public.wishlists w join public.cards c on c.id=w.card_id where w.user_id=$1 order by c.source_id",
        [player]
      )
    ).rows.map(row => row.source_id);

  await t.test("legacy license name", async () => {
    assert.equal(await add("Wish album"), 2);
    assert.deepEqual(await wishlisted(), ["wish-b", "wish-c", "wish-d"]);
    assert.equal(await add("Wish album"), 0);
  });

  await t.test("stable binder key", async () => {
    await db.exec("reset role");
    const key = (
      await db.query(
        "select distinct binder_key from public.catalogue_binder_links where source_license='Other album'"
      )
    ).rows[0].binder_key;
    await db.exec("set role authenticated");
    assert.equal(await add(key), 1);
    assert.deepEqual(await wishlisted(), [
      "wish-b",
      "wish-c",
      "wish-d",
      "wish-other"
    ]);
  });

  await t.test("empty binder is rejected", async () => {
    await assert.rejects(add(" "), /BINDER_KEY_REQUIRED/);
  });
});
