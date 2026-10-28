import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261020020000_kdrama_cards_to_series.sql";
const sql = readFileSync(
  new URL(`../supabase/migrations/${migration}`, import.meta.url),
  "utf8"
);
const before = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter(name => name.endsWith(".sql") && name < migration)
  .sort();
const id = index =>
  `98000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

test("KDRAMA cards move to SERIE while keeping KDRAMA as their only license", async t => {
  const { db } = await replayMigrations({ migrations: before });
  t.after(() => db.close());

  for (let index = 1; index <= 129; index++) {
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,$3,'KDRAMA','','C','https://example.test/kdrama.png','kdrama-move-test')",
      [id(index), `kdrama-${index}`, `KDRAMA series ${index}`]
    );
  }
  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,'series-control','Series control','SERIE','OTHER SERIES','C','https://example.test/series.png','kdrama-move-test')",
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
    [{ categorie: "SERIE", franchise: "KDRAMA", count: 129 }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select categorie,count(*)::int as count from public.card_categories where card_id <> $1 group by categorie",
        [id(200)]
      )
    ).rows,
    [{ categorie: "SERIE", count: 129 }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select franchise,position,count(*)::int as count from public.card_franchises where card_id <> $1 group by franchise,position",
        [id(200)]
      )
    ).rows,
    [{ franchise: "KDRAMA", position: 0, count: 129 }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select categorie,franchise from public.cards where id=$1",
        [id(200)]
      )
    ).rows,
    [{ categorie: "SERIE", franchise: "OTHER SERIES" }]
  );
});

test("future SERIE cards keep an explicit KDRAMA license", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,'future-kdrama','Future KDRAMA series','SERIE','KDRAMA','C','https://example.test/future.png','kdrama-move-test')",
    [id(300)]
  );

  assert.deepEqual(
    (
      await db.query(
        "select categorie,franchise from public.cards where id=$1",
        [id(300)]
      )
    ).rows,
    [{ categorie: "SERIE", franchise: "KDRAMA" }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select franchise,position from public.card_franchises where card_id=$1",
        [id(300)]
      )
    ).rows,
    [{ franchise: "KDRAMA", position: 0 }]
  );
});

test("migration rejects a changed production KDRAMA set", async t => {
  const { db } = await replayMigrations({ migrations: before });
  t.after(() => db.close());
  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,'unexpected-kdrama','Unexpected','KDRAMA','','C','https://example.test/unexpected.png','kdrama-move-test')",
    [id(400)]
  );

  await assert.rejects(db.exec(sql), /KDRAMA_CARD_SET_CHANGED/);
  await db.exec("rollback");
  assert.deepEqual(
    (
      await db.query(
        "select categorie,franchise from public.cards where id=$1",
        [id(400)]
      )
    ).rows,
    [{ categorie: "KDRAMA", franchise: "" }]
  );
});
