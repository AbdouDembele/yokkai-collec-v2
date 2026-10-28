import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261020010000_kpop_cards_to_artist.sql";
const sql = readFileSync(
  new URL(`../supabase/migrations/${migration}`, import.meta.url),
  "utf8"
);
const before = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter(name => name.endsWith(".sql") && name < migration)
  .sort();
const id = index =>
  `97000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

test("KPOP cards move to ARTIST while keeping KPOP as their only license", async t => {
  const { db } = await replayMigrations({ migrations: before });
  t.after(() => db.close());

  for (let index = 1; index <= 127; index++) {
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,$3,'KPOP','KPOP','C','https://example.test/kpop.png','kpop-move-test')",
      [id(index), `kpop-${index}`, `KPOP artist ${index}`]
    );
  }
  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,'artist-control','Artist control','ARTIST','ARTIST','C','https://example.test/artist.png','kpop-move-test')",
    [id(200)]
  );
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values($1,'Secondary license',1)",
    [id(1)]
  );

  await db.exec(sql);

  assert.deepEqual(
    (
      await db.query(
        "select categorie,franchise,count(*)::int as count from public.cards where id <> $1 group by categorie,franchise",
        [id(200)]
      )
    ).rows,
    [{ categorie: "ARTIST", franchise: "KPOP", count: 127 }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select categorie,count(*)::int as count from public.card_categories where card_id <> $1 group by categorie",
        [id(200)]
      )
    ).rows,
    [{ categorie: "ARTIST", count: 127 }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select franchise,position,count(*)::int as count from public.card_franchises where card_id <> $1 group by franchise,position",
        [id(200)]
      )
    ).rows,
    [{ franchise: "KPOP", position: 0, count: 127 }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select categorie,franchise from public.cards where id=$1",
        [id(200)]
      )
    ).rows,
    [{ categorie: "ARTIST", franchise: "ARTIST" }]
  );
});

test("future ARTIST cards keep an explicit KPOP license", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,'future-kpop','Future KPOP artist','ARTIST','KPOP','C','https://example.test/future.png','kpop-move-test')",
    [id(300)]
  );
  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,'future-generic','Future generic artist','ARTIST','','C','https://example.test/generic.png','kpop-move-test')",
    [id(301)]
  );

  assert.deepEqual(
    (
      await db.query(
        "select card_id,franchise from public.card_franchises where card_id in ($1,$2) order by card_id",
        [id(300), id(301)]
      )
    ).rows,
    [{ card_id: id(300), franchise: "KPOP" }]
  );
  assert.deepEqual(
    (
      await db.query("select franchise from public.cards where id=$1", [
        id(301)
      ])
    ).rows,
    [{ franchise: null }]
  );
});

test("migration rejects a changed production KPOP set", async t => {
  const { db } = await replayMigrations({ migrations: before });
  t.after(() => db.close());
  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,'unexpected-kpop','Unexpected','KPOP','KPOP','C','https://example.test/unexpected.png','kpop-move-test')",
    [id(400)]
  );

  await assert.rejects(db.exec(sql), /KPOP_CARD_SET_CHANGED/);
  await db.exec("rollback");
  assert.deepEqual(
    (
      await db.query(
        "select categorie,franchise from public.cards where id=$1",
        [id(400)]
      )
    ).rows,
    [{ categorie: "KPOP", franchise: "KPOP" }]
  );
});
