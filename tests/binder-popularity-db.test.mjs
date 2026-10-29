import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("binder discovery ranks distinct effective favorites globally before pagination and preserves private reads", async t => {
  const migration = "20261029210000_binder_popularity.sql";
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(n => n.endsWith(".sql") && n < migration)
      .sort()
  });
  t.after(() => db.close());
  const users = Array.from(
    { length: 5 },
    (_, i) => "ae900000-0000-4000-8000-" + String(i + 1).padStart(12, "0")
  );
  const [viewer, one, two, three, privateUser] = users;
  for (const [i, id] of users.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: "Popularity" + i })]
    );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [privateUser]
  );
  await db.exec(`insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url)
    select 'manual','popularity-'||i,'Card '||i,'Discovery '||lpad(i::text,3,'0'),'ANIME/MANGA','C','https://example.test/card.png' from generate_series(1,80) i;
    update public.anime_series_settings set enabled=true,license_grouping_enabled=true;`);
  const sourceKey = name =>
    "source:" +
    createHash("sha256")
      .update("ANIME/MANGA\x1f" + name)
      .digest("hex");
  const merged = "ae910000-0000-4000-8000-000000000001",
    key = "series:" + merged;
  await db.query(
    "insert into public.catalogue_binder_groups values($1,'Popular merged license',true)",
    [merged]
  );
  for (const name of ["Discovery 079", "Discovery 080"])
    await db.query(
      "insert into public.catalogue_binder_group_merges(old_key,group_id,category,source_license) values($1,$2,'ANIME/MANGA',$3)",
      [sourceKey(name), merged, name]
    );
  await db.query(
    `insert into public.panini_album_favorites(user_id,license) values
    ($1,'Discovery 079'),($1,'Discovery 080'),($2,'Discovery 080'),($3,'Discovery 080'),($4,'Discovery 001')`,
    [one, two, three, privateUser]
  );
  await db.query(
    `insert into public.binder_favorite_preferences(user_id,binder_key,favorite,license_favorite)
    values($1,$3,true,true),($2,$3,true,true),($2,$4,false,false)`,
    [two, three, sourceKey("Discovery 079"), key]
  );
  // A private collection favorite can contribute to an anonymous aggregate.
  // Its cards and individual favorite list remain protected.
  await db.query(
    `insert into public.user_cards(user_id,card_id,rarity)
    select $1,id,'C' from public.cards where source_id='popularity-1'`,
    [viewer]
  );
  const signatures = [
    "public.get_binder_albums_page(uuid,text,text,boolean,integer,integer)",
    "public.get_panini_albums_page(text,text,integer,integer,boolean)",
    "public.get_friend_panini_albums_page(uuid,text,text,integer,integer)"
  ];
  const contracts = () =>
    db.query(
      "select oid::regprocedure::text as signature,prosecdef,provolatile,proconfig,proacl::text from pg_proc where oid=any($1::regprocedure[]) order by oid::regprocedure::text",
      [signatures]
    );
  const before = (await contracts()).rows;
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual((await contracts()).rows, before);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  const value = async (sql, args = []) =>
    (await db.query(sql, args)).rows[0].value;
  const stable = (offset = 0, limit = 72, query = "", favorites = false) =>
    value("select public.get_binder_albums_page(null,$1,'',$2,$3,$4) value", [
      query,
      favorites,
      offset,
      limit
    ]);
  await db.exec("set role authenticated");
  const first = await stable(0, 1);
  assert.equal(first.items[0].binderKey, key);
  assert.equal(first.items[0].owned, 0); // Popularity outranks the caller's completion.
  assert.equal(first.total, 79);
  const second = await stable(1, 1);
  assert.notEqual(second.items[0].binderKey, key);
  const full = await stable();
  const tail = await stable(72);
  assert.equal(
    new Set([...full.items, ...tail.items].map(x => x.binderKey)).size,
    79
  );
  const count = await value(
    "select jsonb_agg(to_jsonb(p)) value from public.binder_popularity_counts('stable') p"
  );
  assert.equal(count.find(x => x.binder_key === key).favorite_count, 2);
  assert.ok(
    count.every(
      x => Object.keys(x).sort().join(",") === "binder_key,favorite_count"
    )
  );
  assert.equal((await stable(0, 72, "Discovery 010")).items.length, 1);
  assert.equal((await stable(0, 72, "", true)).items.length, 0);
  const legacy = await value(
    "select public.get_panini_albums_page('','',0,1) value"
  );
  assert.equal(legacy.items[0].license, "Discovery 080");
  assert.equal(
    (
      await value(
        "select public.get_friend_panini_albums_page($1,'','',0,1) value",
        [one]
      )
    ).items[0].license,
    "Discovery 079"
  );
  await assert.rejects(
    () =>
      stable(0, 72, "", false).then(() =>
        value("select public.get_binder_albums_page($1) value", [privateUser])
      ),
    /PROFILE_PRIVATE/
  );
  await assert.rejects(
    () =>
      value("select public.get_friend_panini_albums_page($1) value", [
        privateUser
      ]),
    /PROFILE_PRIVATE/
  );
  // An explicit personal favorite remains ahead of globally popular licenses.
  await db.query("select public.set_binder_favorite($1,true)", [
    sourceKey("Discovery 002")
  ]);
  assert.equal((await stable(0, 1)).items[0].license, "Discovery 002");
  await db.exec("reset role");
  // Compare the aggregate with each user's effective favorite list in both modes.
  for (const licensed of [true, false]) {
    await db.query(
      "update public.anime_series_settings set license_grouping_enabled=$1",
      [licensed]
    );
    const actual = (
      await db.query(
        "select binder_key,favorite_count::int n from public.binder_popularity_counts('stable') order by binder_key"
      )
    ).rows;
    const expected = new Map();
    for (const user of users) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user
      ]);
      const result = await value(
        "select public.get_binder_albums_page(null,'','',true,0,72) value"
      );
      for (const item of result.items)
        expected.set(item.binderKey, (expected.get(item.binderKey) ?? 0) + 1);
    }
    assert.deepEqual(
      actual,
      [...expected]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([binder_key, n]) => ({ binder_key, n }))
    );
  }
  await db.exec("set role anon");
  await assert.rejects(
    () => db.query("select * from public.binder_popularity_counts('legacy')"),
    /permission denied/
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(
    () => db.query("select * from public.binder_popularity_counts('stable')"),
    /AUTH_REQUIRED/
  );
});
