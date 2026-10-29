import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261029043000_profile_category_projection_performance.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);

test("category projection preserves the complete profile response, privacy, errors and function privileges", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(n => n.endsWith(".sql") && n < migration)
      .sort()
  });
  t.after(() => db.close());
  const name = "get_profile_details";
  const definition = (
    await db.query(
      "select pg_get_functiondef('public.get_profile_details(text)'::regprocedure) definition"
    )
  ).rows[0].definition;
  await db.exec(
    definition.replace("public." + name + "(", "public.reference_" + name + "(")
  );
  // Mirror the original ACL for comparisons under anon/authenticated roles.
  await db.exec(
    "revoke all on function public.reference_get_profile_details(text) from public,anon; grant execute on function public.reference_get_profile_details(text) to authenticated,service_role"
  );
  const properties = () =>
    db.query(
      "select prosecdef,provolatile,proconfig,proacl::text,pg_get_userbyid(proowner) owner from pg_proc where oid='public.get_profile_details(text)'::regprocedure"
    );
  const before = (await properties()).rows;
  const [owner, viewer, friend] = [1, 2, 3].map(
    n => `f8100000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  for (const [i, id] of [owner, viewer, friend].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: "CategoryFixture" + i })]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')",
    [owner, friend]
  );
  const categories = [
    "FILM",
    "film",
    " FILM ",
    "Anime/Manga",
    "ANIME/MANGA",
    "   ",
    "Esport",
    "esport",
    "ÉDITORIAL",
    "éditorial",
    " New Category "
  ];
  for (let i = 0; i < categories.length * 3; i++) {
    const result = await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)values('test',$1,$2,$3,'Projection Fixture',$4,'https://example.test/image.png')returning id",
      [
        "category-" + i,
        "Projection " + i,
        categories[i % categories.length],
        ["C", "R", "SR", "SSR", "LR"][i % 5]
      ]
    );
    if (i < 10)
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity)values($1,$2,$3)",
        [owner, result.rows[0].id, ["C", "R", "SR", "SSR", "LR"][i % 5]]
      );
  }
  await db.query(
    "insert into public.panini_album_favorites(user_id,license)values($1,'Projection Fixture')",
    [owner]
  );
  const cardSnapshot = (await db.query("select *from public.cards order by id"))
    .rows;
  const userSnapshot = (
    await db.query("select *from public.user_cards order by id")
  ).rows;
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual(
    (await properties()).rows,
    before,
    "ACL, owner, volatility, search_path and security mode remain unchanged"
  );
  assert.deepEqual(
    (await db.query("select *from public.cards order by id")).rows,
    cardSnapshot
  );
  assert.deepEqual(
    (await db.query("select *from public.user_cards order by id")).rows,
    userSnapshot
  );
  const compare = async identifier => {
    const row = (
      await db.query(
        "select public.get_profile_details($1) value,public.reference_get_profile_details($1) reference",
        [identifier]
      )
    ).rows[0];
    assert.deepEqual(row.value, row.reference);
    const expected = (
      await db.query(
        "select coalesce(jsonb_agg(category order by category),'[]'::jsonb) categories from(select distinct upper(btrim(categorie)) category from public.cards where btrim(categorie)<>'')c"
      )
    ).rows[0].categories;
    assert.deepEqual(row.value.widgetCategories, expected);
  };
  for (const isPublic of [true, false]) {
    await db.query(
      "update public.user_profiles set is_public=$1 where user_id=$2",
      [isPublic, owner]
    );
    for (const actor of [owner, viewer, friend]) {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        actor
      ]);
      for (const identifier of [owner, "CategoryFixture0", null])
        await compare(identifier);
      await db.exec("reset role");
    }
  }
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id)values($1,$2)",
    [owner, viewer]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  await compare(owner);
  for (const fn of ["get_profile_details", "reference_get_profile_details"])
    await assert.rejects(
      db.query(`select public.${fn}('missing-profile')`),
      /PROFILE_NOT_FOUND/
    );
  await db.exec("reset role; set role anon");
  for (const fn of ["get_profile_details", "reference_get_profile_details"])
    await assert.rejects(
      db.query(`select public.${fn}($1)`, [owner]),
      /permission denied/
    );
});
