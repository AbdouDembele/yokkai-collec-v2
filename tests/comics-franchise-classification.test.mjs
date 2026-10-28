import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("classe les cartes COMICS sans licence selon leur univers", async () => {
  const db = new PGlite();
  await db.exec(`
    create table public.cards (
      id integer primary key,
      nom text not null,
      categorie text not null,
      franchise text
    );
    insert into public.cards (id, nom, categorie, franchise) values
      (1, 'SPIDER-MAN', 'COMICS', null),
      (2, 'BATMAN', 'COMICS', ''),
      (3, 'ATOM EVE — SAMANTHA EVE WILKINS', 'COMICS', '   '),
      (4, 'TEENAGE MUTANT NINJA TURTLES – LEONARDO', 'COMICS', null),
      (5, 'THE MASK', 'COMICS', null),
      (6, 'SUPERMAN', 'COMICS', 'Licence existante'),
      (7, 'BATMAN', 'VIDEO GAMES', null),
      (8, 'PERSONNAGE INCONNU', 'COMICS', null),
      (9, 'ANISSA', 'COMICS', null);
  `);

  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261004000012_classify_comics_franchises.sql",
      import.meta.url
    ),
    "utf8"
  );
  await db.exec(migration);

  const { rows } = await db.query(
    "select id, franchise from public.cards order by id"
  );
  assert.deepEqual(rows, [
    { id: 1, franchise: "Marvel" },
    { id: 2, franchise: "DC Comics" },
    { id: 3, franchise: "Invincible" },
    { id: 4, franchise: "Teenage Mutant Ninja Turtles" },
    { id: 5, franchise: "The Mask" },
    { id: 6, franchise: "Licence existante" },
    { id: 7, franchise: null },
    { id: 8, franchise: null },
    { id: 9, franchise: "Invincible" }
  ]);
});
