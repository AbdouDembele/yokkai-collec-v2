import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const viewer = "72000000-0000-4000-8000-000000000001";

test("card filters accept several rarities and categories as a JSON array", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [viewer, JSON.stringify({ pseudo: "MultiFilter" })]
  );
  await db.exec(`
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values
      ('multi-lr','Multi LR','ANIME/MANGA','Multi album','LR','https://example.test/a.png','multi-test'),
      ('multi-ssr','Multi SSR','COMICS','Multi album','SSR','https://example.test/b.png','multi-test'),
      ('multi-sr','Multi SR','ANIME/MANGA','Multi album','SR','https://example.test/c.png','multi-test'),
      ('multi-c','Multi C','FILM','Multi album','C','https://example.test/d.png','multi-test');
  `);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  const names = value => value.items.map(card => card.name).sort();
  const catalogue = async (category, rarity) =>
    (
      await db.query(
        "select public.get_catalogue_cards_page('multi',$1,$2,0,24) as value",
        [category, rarity]
      )
    ).rows[0].value;
  const binder = async (category, rarity) =>
    (
      await db.query(
        "select public.get_panini_album_cards_page('Multi album','',$1,false,0,24,$2) as value",
        [category, rarity]
      )
    ).rows[0].value;
  const albums = async category =>
    (
      await db.query(
        "select public.get_panini_albums_page('Multi',$1,0,72,false) as value",
        [category]
      )
    ).rows[0].value;

  await t.test("legacy single values still work", async () => {
    assert.deepEqual(names(await catalogue("", "LR")), ["MULTI LR"]);
    assert.deepEqual(names(await binder("COMICS", "")), ["MULTI SSR"]);
  });

  await t.test("several rarities and categories combine", async () => {
    assert.deepEqual(names(await catalogue("", '["LR","SSR"]')), [
      "MULTI LR",
      "MULTI SSR"
    ]);
    assert.deepEqual(
      names(await catalogue('["ANIME/MANGA","FILM"]', '["SR","C"]')),
      ["MULTI C", "MULTI SR"]
    );
    const page = await binder('["COMICS","ANIME/MANGA"]', '["ssr","SR","C"]');
    assert.deepEqual(names(page), ["MULTI SR", "MULTI SSR"]);
    assert.equal(page.total, 2);
    assert.equal((await albums('["COMICS","ANIME/MANGA"]')).items[0].total, 3);
  });

  await t.test("unknown rarities are still rejected", async () => {
    await assert.rejects(binder("", '["LR","XL"]'), /INVALID_RARITY/);
  });
});
