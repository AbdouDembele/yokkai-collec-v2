import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("la vitrine accepte cinq cartes et refuse une sixième", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.cards (id uuid primary key);
    create table public.user_profiles (
      user_id uuid primary key,
      bio text not null default '',
      avatar_url text,
      featured_card_ids uuid[] not null default '{}'::uuid[]
        constraint user_profiles_featured_card_ids_check check (cardinality(featured_card_ids) <= 4),
      banner_card_id uuid references public.cards(id)
    );
    create table public.user_cards (id uuid primary key, user_id uuid not null);
    create function public.get_profile(text default null) returns jsonb
      language sql stable as $$ select '{}'::jsonb $$;
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261004000009_profile_showcase_five_cards.sql",
        import.meta.url
      ),
      "utf8"
    )
  );

  const player = "00000000-0000-0000-0000-000000000001";
  const ids = Array.from(
    { length: 6 },
    (_, index) =>
      `00000000-0000-0000-0001-${String(index + 1).padStart(12, "0")}`
  );
  await db.query("insert into public.user_profiles(user_id) values ($1)", [
    player
  ]);
  for (const id of ids)
    await db.query("insert into public.user_cards(id,user_id) values ($1,$2)", [
      id,
      player
    ]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);

  await db.query("select public.update_profile('',null,$1::uuid[],null)", [
    ids.slice(0, 5)
  ]);
  await db.exec("reset role");
  assert.equal(
    Number(
      (
        await db.query(
          "select cardinality(featured_card_ids) as count from public.user_profiles where user_id=$1",
          [player]
        )
      ).rows[0].count
    ),
    5
  );

  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  await assert.rejects(
    db.query("select public.update_profile('',null,$1::uuid[],null)", [ids]),
    /FEATURED_CARDS_INVALID/
  );
  await db.exec("reset role");
});
