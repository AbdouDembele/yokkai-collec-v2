import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261015000006_merge_jujutsu_kaisen_modulo.sql";
const sql = readFileSync(
  new URL(`../supabase/migrations/${migration}`, import.meta.url),
  "utf8"
);
const before = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter(name => name.endsWith(".sql") && name < migration)
  .sort();
const player = "95000000-0000-4000-8000-000000000001";
const id = i => `96000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

async function seed(db, count = 10) {
  await db.exec("set time zone 'UTC'");
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"ModuloMerge"}\')',
    [player]
  );
  for (let i = 1; i <= count; i++) {
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,$3,'ANIME/MANGA','Jujutsu Kaisen Modulo','C','https://example.test/modulo.png','modulo-test')",
      [id(i), `modulo-${i}`, `Modulo ${i}`]
    );
  }
  await db.exec(`
    insert into public.user_cards(user_id,card_id,rarity)
      values('${player}','${id(1)}','C');
    insert into public.wishlists(user_id,card_id) values('${player}','${id(2)}');
    insert into public.panini_album_favorites(user_id,license,created_at)
      values('${player}','Jujutsu Kaisen Modulo','2026-10-01'),
        ('${player}','JUJUTSU KAISEN MODULO','2026-10-02');
    insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
      values('${id(20)}','modulo-existing','Existing','ANIME/MANGA','JUJUTSU KAISEN MODULO','LR','https://example.test/existing.png','modulo-test'),
        ('${id(21)}','modulo-cross','Crossed','ANIME/MANGA','Jujutsu Kaisen','SSR','https://example.test/crossed.png','modulo-test');
    insert into public.card_franchises(card_id,franchise,position)
      values('${id(21)}','Jujutsu Kaisen Modulo',1),('${id(1)}','Another licence',1);
  `);
}

test("fusion Modulo : dix cartes et leurs liens, sans perte d'exemplaires ni de wishlist", async t => {
  const { db } = await replayMigrations({ migrations: before });
  t.after(() => db.close());
  await seed(db);
  const cards = (await db.query("select * from public.cards order by id")).rows;
  const copies = (await db.query("select * from public.user_cards order by id"))
    .rows;
  const wishlist = (
    await db.query("select * from public.wishlists order by card_id")
  ).rows;
  const links = (
    await db.query(
      "select * from public.card_franchises order by card_id,position"
    )
  ).rows;
  const expectedCards = cards.map(card => ({
    ...card,
    franchise:
      card.franchise === "Jujutsu Kaisen Modulo"
        ? "JUJUTSU KAISEN MODULO"
        : card.franchise
  }));
  const expectedLinks = links.map(link => ({
    ...link,
    franchise:
      link.franchise === "Jujutsu Kaisen Modulo"
        ? "JUJUTSU KAISEN MODULO"
        : link.franchise
  }));

  await db.exec(sql);
  assert.deepEqual(
    (await db.query("select * from public.cards order by id")).rows,
    expectedCards
  );
  assert.deepEqual(
    (
      await db.query(
        "select * from public.card_franchises order by card_id,position"
      )
    ).rows,
    expectedLinks
  );
  assert.deepEqual(
    (await db.query("select * from public.user_cards order by id")).rows,
    copies
  );
  assert.deepEqual(
    (await db.query("select * from public.wishlists order by card_id")).rows,
    wishlist
  );
  assert.deepEqual(
    (
      await db.query(
        "select license,created_at::text from public.panini_album_favorites"
      )
    ).rows,
    [{ license: "JUJUTSU KAISEN MODULO", created_at: "2026-10-01 00:00:00+00" }]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  const album = (
    await db.query(
      "select public.get_panini_albums_page('Jujutsu Kaisen Modulo','ANIME/MANGA',0,72) as value"
    )
  ).rows[0].value;
  assert.equal(album.total, 1);
  assert.equal(album.items[0].license, "JUJUTSU KAISEN MODULO");
  assert.equal(album.items[0].total, 12);
  assert.equal(album.items[0].owned, 1);
  assert.equal(album.items[0].favorite, true);
  await db.exec("reset role");
  // A second application is harmless and preserves the original favourite date.
  await db.exec(sql);
  assert.deepEqual(
    (await db.query("select * from public.cards order by id")).rows,
    expectedCards
  );
});

test("imports futurs normalisés en ANIME/MANGA seulement, règles existantes intactes", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [input, expected] of [
    ["Jujutsu Kaisen Modulo", "JUJUTSU KAISEN MODULO"],
    ["  jujutsu kaisen modulo  ", "JUJUTSU KAISEN MODULO"],
    ["Black Butler: Book of Circus", "Black Butler"],
    ["Ace of the Diamond act II", "Ace of the Diamond"],
    ["Devil May Cry III", "Devil May Cry III"],
    ["Jujutsu Kaisen", "Jujutsu Kaisen"]
  ]) {
    assert.equal(
      (
        await db.query("select public.normalize_anime_franchise($1) as value", [
          input
        ])
      ).rows[0].value,
      expected
    );
  }
  for (const [i, category] of [
    [30, "ANIME/MANGA"],
    [31, "VIDEO GAMES"]
  ]) {
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,'Future',$3,'Jujutsu Kaisen Modulo','C','https://example.test/new.png','modulo-test')",
      [id(i), `future-${i}`, category]
    );
    const expected =
      category === "ANIME/MANGA"
        ? "JUJUTSU KAISEN MODULO"
        : "Jujutsu Kaisen Modulo";
    assert.equal(
      (
        await db.query("select franchise from public.cards where id=$1", [
          id(i)
        ])
      ).rows[0].franchise,
      expected
    );
    assert.equal(
      (
        await db.query(
          "select franchise from public.card_franchises where card_id=$1",
          [id(i)]
        )
      ).rows[0].franchise,
      expected
    );
  }
  for (const [i, category] of [
    [40, "ANIME/MANGA"],
    [41, "VIDEO GAMES"]
  ]) {
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,'Secondary',$3,'Another licence','C','https://example.test/link.png','modulo-test')",
      [id(i), `secondary-${i}`, category]
    );
    await db.query(
      "insert into public.card_franchises(card_id,franchise,position) values($1,'Jujutsu Kaisen Modulo',1)",
      [id(i)]
    );
    assert.equal(
      (
        await db.query(
          "select franchise from public.card_franchises where card_id=$1 and position=1",
          [id(i)]
        )
      ).rows[0].franchise,
      category === "ANIME/MANGA"
        ? "JUJUTSU KAISEN MODULO"
        : "Jujutsu Kaisen Modulo"
    );
  }
});

test("les cartes et favoris d'une autre catégorie ne sont pas supprimés", async t => {
  const { db } = await replayMigrations({ migrations: before });
  t.after(() => db.close());
  await seed(db);
  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,'other-category','Preserved','VIDEO GAMES','Jujutsu Kaisen Modulo','C','https://example.test/game.png','modulo-test')",
    [id(50)]
  );
  await db.exec(sql);
  assert.equal(
    (await db.query("select franchise from public.cards where id=$1", [id(50)]))
      .rows[0].franchise,
    "Jujutsu Kaisen Modulo"
  );
  assert.equal(
    (
      await db.query(
        "select franchise from public.card_franchises where card_id=$1",
        [id(50)]
      )
    ).rows[0].franchise,
    "Jujutsu Kaisen Modulo"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.panini_album_favorites where user_id=$1",
        [player]
      )
    ).rows[0].count,
    2
  );
});

test("la migration refuse une source modifiée et conserve les données", async t => {
  const { db } = await replayMigrations({ migrations: before });
  t.after(() => db.close());
  await seed(db, 11);
  await assert.rejects(db.exec(sql), /JUJUTSU_MODULO_SOURCE_CHANGED/);
  await db.exec("rollback");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.cards where franchise='Jujutsu Kaisen Modulo'"
      )
    ).rows[0].count,
    11
  );
  assert.equal(
    (
      await db.query(
        "select public.normalize_anime_franchise('Jujutsu Kaisen Modulo') as value"
      )
    ).rows[0].value,
    "Jujutsu Kaisen Modulo"
  );
});
