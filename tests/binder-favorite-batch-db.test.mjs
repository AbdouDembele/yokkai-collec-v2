import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("batch resolution preserves 51 legacy favorites, aliases, ambiguity, explicit choices and rollback", async t => {
  const migration = "20261025050000_batch_legacy_binder_favorites.sql";
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = readdirSync(directory)
    .filter(n => n.endsWith(".sql") && n < migration)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  const owner = "ad100000-0000-4000-8000-000000000001";
  const other = "ad100000-0000-4000-8000-000000000002";
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"BatchOwner"}\'),($2,\'{"pseudo":"BatchOther"}\')',
    [owner, other]
  );
  const roots = [
    "ad200000-0000-4000-8000-000000000001",
    "ad200000-0000-4000-8000-000000000002"
  ];
  for (let i = 0; i < roots.length; i++) {
    await db.query("insert into public.anime_series_binders values($1,$2,$3)", [
      roots[i],
      100 + i,
      "Confirmed " + i
    ]);
    await db.query("insert into public.anime_license_binders values($1,$2)", [
      roots[i],
      "Confirmed " + i
    ]);
    await db.query(
      "insert into public.anime_license_aliases values($1,'Shared verified alias')",
      [roots[i]]
    );
  }
  const licenses = Array.from({ length: 48 }, (_, i) => "Legacy " + i).concat([
    "Shared verified alias",
    "Cross category",
    "Missing title"
  ]);
  for (let i = 0; i < 48; i++) {
    await db.query(
      "insert into public.cards(source_id,source,nom,franchise,categorie,rarete_base,image_url) values($1,'manual',$2,$2,'ANIME/MANGA','C','https://example.test/batch.png')",
      ["batch-" + i, licenses[i]]
    );
    if (i < 4)
      await db.query(
        "insert into public.anime_license_source_rules values($1,$2)",
        [licenses[i], roots[i % 2]]
      );
  }
  for (const category of ["FILM", "COMICS"]) {
    const card = (
      await db.query(
        "insert into public.cards(source_id,source,nom,franchise,categorie,rarete_base,image_url) values($1,'manual','Shared character','Cross category',$2,'C','https://example.test/batch.png') returning id",
        [category, category]
      )
    ).rows[0];
    await db.query(
      "insert into public.card_franchises(card_id,franchise,position) values($1,'Cross category',1) on conflict do nothing",
      [card.id]
    );
  }
  for (const license of licenses)
    await db.query(
      "insert into public.panini_album_favorites(user_id,license) values($1,$2)",
      [owner, license]
    );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values($1,'Legacy 47')",
    [other]
  );
  await db.query(
    "insert into public.binder_legacy_favorite_resolutions(user_id,license) values($1,'Legacy 46')",
    [owner]
  );
  await db.query(
    "insert into public.binder_favorite_preferences(user_id,binder_key,favorite,license_favorite) values($1,$2,true,false),($1,$3,false,true)",
    [owner, "series:" + roots[0], "series:" + roots[1]]
  );
  await db.exec(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true,license_mapping_version='batch-fixture'"
  );
  const value = async q => (await db.query(q)).rows[0].value;
  const capture = async () => {
    const targets = (
      await db.query(
        "select f.license,t.target_key from public.panini_album_favorites f cross join lateral public.legacy_binder_targets(f.license,null) t where f.user_id=$1 and not exists(select 1 from public.binder_legacy_favorite_resolutions r where r.user_id=f.user_id and r.license=f.license) order by f.license,t.target_key",
        [owner]
      )
    ).rows;
    const keys = (
      await db.query(
        "select * from public.binder_favorite_keys($1) order by binder_key",
        [owner]
      )
    ).rows;
    const conflicts = await value(
      `select public.binder_favorite_conflicts('${owner}') value`
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner
    ]);
    const albums = await value(
      "select public.get_binder_albums_page(null,'','',false,0,72) value"
    );
    const favorites = await value(
      "select public.get_binder_albums_page(null,'','',true,0,72) value"
    );
    return { targets, keys, conflicts, albums, favorites };
  };
  const tables = [
    "cards",
    "card_franchises",
    "panini_album_favorites",
    "binder_favorite_preferences",
    "binder_legacy_favorite_resolutions",
    "user_cards",
    "user_profiles"
  ];
  const records = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async name => [
          name,
          (
            await db.query(
              `select to_jsonb(t) row from public.${name} t order by to_jsonb(t)::text`
            )
          ).rows
        ])
      )
    );
  const beforeRecords = await records();
  const before = await capture();
  assert.equal(licenses.length, 51);
  assert.equal(
    before.targets.filter(t => t.license === "Shared verified alias").length,
    2
  );
  assert.equal(
    before.targets.filter(t => t.license === "Cross category").length,
    2
  );
  assert(
    !before.targets.some(t =>
      ["Legacy 46", "Missing title"].includes(t.license)
    )
  );
  assert(!before.keys.some(k => k.binder_key === "series:" + roots[0]));
  assert(before.keys.some(k => k.binder_key === "series:" + roots[1]));
  await db.exec(
    "update public.anime_series_settings set license_grouping_enabled=false"
  );
  const rollbackBefore = await capture();
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual(await capture(), rollbackBefore);
  await db.exec(
    "update public.anime_series_settings set license_grouping_enabled=true"
  );
  assert.deepEqual(await capture(), before);
  assert.deepEqual(
    (
      await db.query(
        "select * from public.binder_legacy_favorite_targets($1) order by license,target_key",
        [owner]
      )
    ).rows,
    before.targets
  );
  assert.deepEqual(await records(), beforeRecords);
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec("set role " + role);
    await assert.rejects(
      db.query("select * from public.binder_legacy_favorite_targets($1)", [
        owner
      ]),
      /permission denied/i
    );
    await db.exec("reset role");
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other
  ]);
  await db.exec("set role authenticated");
  const own = await value(
    "select public.get_binder_albums_page(null,'','',true,0,72) value"
  );
  assert.deepEqual(
    own.items.map(i => i.license),
    ["Legacy 47"]
  );
});
