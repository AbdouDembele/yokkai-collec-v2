import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("la licence Naruto: Shippuden est regroupée sous Naruto", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table public.cards (id integer primary key, franchise text);
    insert into public.cards(id,franchise) values
      (1,'Naruto: Shippuden'),
      (2,' NARUTO: SHIPPUDEN '),
      (3,'Boruto: Naruto Next Generations');
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261004000011_normalize_naruto_franchise.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.deepEqual(
    (await db.query("select id,franchise from public.cards order by id")).rows,
    [
      { id: 1, franchise: "Naruto" },
      { id: 2, franchise: "Naruto" },
      { id: 3, franchise: "Boruto: Naruto Next Generations" }
    ]
  );
});
