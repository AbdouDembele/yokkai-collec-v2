import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261104150000_catalogue_links_cache.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);
const columns =
  "card_id::text,category,source_license,binder_key,display_name,origin,series_binder_id::text";
const rows = async (db, relation) =>
  (
    await db.query(
      `select ${columns} from ${relation} order by 1,2,3,4,5,6,7 nulls first`
    )
  ).rows;

test("catalogue links cache is exact whether fresh or stale and stays private", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(name => name.endsWith(".sql") && name <= migration)
      .sort()
      .filter(name => name !== migration)
  });
  t.after(() => db.close());

  const owner = "f9100000-0000-4000-8000-000000000001",
    binder = "f9200000-0000-4000-8000-000000000001",
    group = "f9200000-0000-4000-8000-000000000002";
  await db.query(
    'insert into auth.users(id,raw_user_meta_data)values($1,\'{"pseudo":"Links Fixture"}\')',
    [owner]
  );
  await db.query(
    "insert into public.anime_series_binders values($1,97001,'Links Series')",
    [binder]
  );
  await db.query(
    "insert into public.anime_license_binders values($1,'Links License')",
    [binder]
  );
  await db.query(
    "insert into public.anime_license_source_rules values('Links Source',$1)",
    [binder]
  );
  await db.query(
    "insert into public.catalogue_binder_groups values($1,'Links Merge',false)",
    [group]
  );
  await db.query(
    "insert into public.catalogue_binder_group_merges(old_key,group_id)values($1,$2)",
    ["series:" + binder, group]
  );
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const id = "f9300000-0000-4000-8000-" + String(i + 1).padStart(12, "0");
    ids.push(id);
    await db.query(
      "insert into public.cards(id,source,source_id,nom,categorie,franchise,rarete_base,image_url)values($1,'test',$2,$3,$4,$5,$6,'https://example.test/links.png')",
      [
        id,
        "links-" + i,
        "Links Card " + i,
        i % 3 ? "ANIME/MANGA" : "FILM",
        i % 2 ? "Links Source" : "Other Links Source",
        ["C", "R", "SR", "SSR", "LR"][i % 5]
      ]
    );
  }
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position)values($1,'Secondary Links',1)",
    [ids[1]]
  );
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity) select $1,id,rarete_base from public.cards where id=any($2::uuid[])",
    [owner, ids.slice(0, 5)]
  );
  const before = await rows(db, "public.catalogue_binder_links");
  assert.ok(before.length >= ids.length, "fixture produces links");

  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  const state = async () =>
    (
      await db.query(
        "select version=built_version fresh from public.catalogue_links_cache_state"
      )
    ).rows[0].fresh;
  const refresh = () =>
    db.query("select public.refresh_catalogue_links_cache()");
  assert.equal(await state(), true, "fresh right after the migration");
  assert.deepEqual(await rows(db, "public.catalogue_binder_links"), before);
  assert.deepEqual(
    await rows(db, "public.catalogue_binder_links_cache"),
    before
  );

  // Player-facing functions give the same results from the cache (fresh) and
  // from the original definition (stale).
  const outputs = async () => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner
    ]);
    try {
      return (
        await db.query(
          `select public.get_binder_albums_page(null,'','',false,0,72) albums,
            public.get_binder_albums_page(null,'links','',false,0,72) search,
            public.get_card_binder_metadata($1::uuid[]) metadata,
            public.get_binder_catalogue_page('','','',0,60,'rarity') catalogue`,
          [ids]
        )
      ).rows[0];
    } finally {
      await db.exec("reset role");
    }
  };
  const same = async label => {
    assert.deepEqual(
      await rows(db, "public.catalogue_binder_links"),
      await rows(db, "public.catalogue_binder_links_source"),
      label
    );
  };
  const roundTrip = async label => {
    assert.equal(await state(), false, `${label}: marked stale`);
    await same(`${label}: stale view reads the source`);
    const stale = await outputs();
    await refresh();
    assert.equal(await state(), true, `${label}: rebuilt`);
    await same(`${label}: fresh view reads the cache`);
    assert.deepEqual(await outputs(), stale, `${label}: same function results`);
  };

  await db.query(
    "update public.cards set image_url='https://example.test/other.png' where id=$1",
    [ids[0]]
  );
  assert.equal(await state(), true, "unrelated card columns do not invalidate");

  await db.query(
    "update public.cards set franchise='Links Source' where id=$1",
    [ids[0]]
  );
  await roundTrip("card franchise changed");
  await db.query(
    "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)values('test','links-new','Links New','ANIME/MANGA','Links Source','SR','https://example.test/links.png')"
  );
  await roundTrip("card inserted");
  await db.query(
    "update public.catalogue_binder_groups set enabled=true where id=$1",
    [group]
  );
  await roundTrip("editorial group enabled");
  await db.query(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true"
  );
  await roundTrip("license grouping enabled");
  await db.query("delete from public.card_franchises where card_id=$1", [
    ids[1]
  ]);
  await roundTrip("secondary franchise removed");

  // A change committed after the rebuild read its version keeps it stale.
  await db.query(
    "update public.catalogue_links_cache_state set version=version+1"
  );
  await refresh();
  await db.query("update public.cards set categorie='FILM' where id=$1", [
    ids[2]
  ]);
  await roundTrip("change after a rebuild");

  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec("set role " + role);
    for (const relation of [
      "public.catalogue_binder_links",
      "public.catalogue_binder_links_source",
      "public.catalogue_binder_links_cache",
      "public.catalogue_links_cache_state"
    ])
      await assert.rejects(
        () => db.query(`select * from ${relation}`),
        /permission denied/,
        `${role} on ${relation}`
      );
    await assert.rejects(
      () => db.query("select public.refresh_catalogue_links_cache()"),
      /permission denied/
    );
    await db.exec("reset role");
  }
});
