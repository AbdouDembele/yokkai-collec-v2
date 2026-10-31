import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("shared catalogue preserves exact album payloads, global ambiguity, private votes, contracts and rollback", async t => {
  const migration = "20261031130000_shared_binder_catalogue.sql",
    directory = new URL("../supabase/migrations/", import.meta.url);
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(n => n.endsWith(".sql") && n < migration)
      .sort()
  });
  t.after(() => db.close());
  const users = [
    "bc130000-0000-4000-8000-000000000001",
    "bc130000-0000-4000-8000-000000000002",
    "bc130000-0000-4000-8000-000000000003"
  ];
  for (const [i, id] of users.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2)",
      [id, JSON.stringify({ pseudo: "SharedCatalogue" + i })]
    );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [users[2]]
  );
  await db.exec(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true;insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url)select 'manual','shared-'||i,'Shared card '||i,'Shared '||lpad(i::text,3,'0'),'ANIME/MANGA','C','https://example.test/'||i||'.png'from generate_series(1,80)i;"
  );
  for (const category of ["ANIME/MANGA", "VIDEO GAMES"])
    await db.query(
      "insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url)values('manual',$1,'Cross category','Shared Cross',$2,'SSR','https://example.test/cross.png')",
      ["cross-" + category, category]
    );
  await db.exec(
    "insert into public.card_franchises(card_id,franchise,position)select id,'Shared Secondary',1 from public.cards where source_id='shared-1'"
  );
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity)select $1,id,rarete_base from public.cards where source_id in('shared-1','shared-79')",
    [users[0]]
  );
  const key = name =>
    "source:" +
    createHash("sha256")
      .update("ANIME/MANGA\x1f" + name)
      .digest("hex");
  const group = "bc130000-0000-4000-8000-000000000010";
  await db.query(
    "insert into public.catalogue_binder_groups(id,display_name,enabled)values($1,'Shared Merged',true)",
    [group]
  );
  for (const name of ["Shared 079", "Shared 080"])
    await db.query(
      "insert into public.catalogue_binder_group_merges(old_key,group_id)values($1,$2)",
      [key(name), group]
    );
  for (const id of users)
    for (const name of ["Shared 079", "Shared 080", "Shared Cross"])
      await db.query(
        "insert into public.panini_album_favorites(user_id,license)values($1,$2)",
        [id, name]
      );
  await db.query(
    "insert into public.binder_favorite_preferences(user_id,binder_key,favorite,license_favorite)values($1,$2,true,false),($3,$2,true,true)",
    [users[1], "series:" + group, users[2]]
  );
  const signature =
    "public.get_binder_albums_page(uuid,text,text,boolean,integer,integer)";
  const contract = async () =>
    (
      await db.query(
        "select prosecdef,provolatile,proconfig,proacl::text from pg_proc where oid=$1::regprocedure",
        [signature]
      )
    ).rows[0];
  const cases = [];
  for (const licensed of [true, false])
    for (const viewer of users)
      for (const category of ["", "ANIME/MANGA", "VIDEO GAMES"])
        for (const favorites of [false, true])
          cases.push({
            licensed,
            viewer,
            owner: null,
            query: "",
            category,
            favorites,
            offset: 0,
            limit: 72
          });
  cases.push({
    licensed: true,
    viewer: users[0],
    owner: users[1],
    query: "Shared",
    category: "",
    favorites: false,
    offset: 1,
    limit: 4
  });
  cases.push({
    licensed: true,
    viewer: users[0],
    owner: null,
    query: "Cross",
    category: "ANIME/MANGA",
    favorites: false,
    offset: 0,
    limit: 72
  });
  cases.push({
    licensed: true,
    viewer: users[0],
    owner: null,
    query: "Secondary",
    category: "",
    favorites: false,
    offset: 0,
    limit: 72
  });
  const readAll = async () => {
    const values = [];
    for (const c of cases) {
      await db.exec("reset role");
      await db.query(
        "update public.anime_series_settings set license_grouping_enabled=$1",
        [c.licensed]
      );
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        c.viewer
      ]);
      await db.exec("set role authenticated");
      values.push(
        (
          await db.query(
            "select public.get_binder_albums_page($1,$2,$3,$4,$5,$6) value",
            [c.owner, c.query, c.category, c.favorites, c.offset, c.limit]
          )
        ).rows[0].value
      );
    }
    await db.exec("reset role");
    return values;
  };
  const before = await readAll(),
    rights = await contract();
  assert.equal(
    before[0].items.length,
    72,
    "Discovery still paginates before returning"
  );
  assert(
    before[0].favoriteConflicts.some(c => c.license === "Shared Cross"),
    "Global cross-category ambiguity is retained"
  );
  assert(before[0].items.some(i => i.binderKey === "series:" + group));
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual(await readAll(), before);
  assert.deepEqual(await contract(), rights);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    users[0]
  ]);
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select public.get_binder_albums_page($1)", [users[2]]),
    /PROFILE_PRIVATE/
  );
  for (const role of ["anon", "public"])
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,$2,'EXECUTE') allowed",
          [role, signature]
        )
      ).rows[0].allowed,
      false
    );
  await db.exec("reset role");
  await db.exec(
    readFileSync(
      new URL("../docs/rollback/shared-binder-catalogue.sql", import.meta.url),
      "utf8"
    )
  );
  assert.deepEqual(await readAll(), before);
  assert.deepEqual(await contract(), rights);
});
