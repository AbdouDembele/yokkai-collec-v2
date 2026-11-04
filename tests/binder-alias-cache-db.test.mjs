import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261104120000_binder_alias_cache.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);

const rows = async (db, relation) =>
  (
    await db.query(
      `select binder_id::text, alias from ${relation} order by 1, 2 nulls first`
    )
  ).rows;

test("binder alias cache always matches the former view and stays private", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(name => name.endsWith(".sql") && name < migration)
      .sort()
  });
  t.after(() => db.close());

  const binder = "f8200000-0000-4000-8000-000000000001",
    other = "f8200000-0000-4000-8000-000000000002",
    group = "f8200000-0000-4000-8000-000000000003";
  await db.query(
    "insert into public.anime_series_binders values($1,98001,'Cache Series'),($2,98002,'Other Series')",
    [binder, other]
  );
  await db.query(
    "insert into public.anime_license_binders values($1,'Cache License')",
    [binder]
  );
  await db.query(
    "insert into public.anime_license_aliases values($1,'Alias B'),($1,'Alias A')",
    [binder]
  );
  await db.query(
    "insert into public.anime_series_aliases values($1,'Legacy Alias'),($2,'Other Alias')",
    [binder, other]
  );
  await db.query(
    "insert into public.catalogue_binder_groups values($1,'Editorial Merge',true)",
    [group]
  );
  await db.query(
    "insert into public.catalogue_binder_group_merges(old_key,group_id)values($1,$2)",
    ["series:" + binder, group]
  );
  const before = await rows(db, "public.active_binder_aliases");
  assert.ok(before.length > 0, "fixture produces aliases");

  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual(
    await rows(db, "public.active_binder_aliases"),
    before,
    "same rows right after the migration"
  );

  const same = async label =>
    assert.deepEqual(
      await rows(db, "public.active_binder_aliases"),
      await rows(db, "public.active_binder_aliases_source"),
      label
    );
  // Every source table refreshes the cache, in every settings combination.
  for (const [enabled, licensed, merged] of [
    [false, false, false],
    [true, false, false],
    [true, true, false],
    [true, true, true]
  ]) {
    await db.query(
      "update public.anime_series_settings set enabled=$1,license_grouping_enabled=$2",
      [enabled, licensed]
    );
    await db.query(
      "update public.catalogue_binder_groups set enabled=$1 where id=$2",
      [merged, group]
    );
    await same(JSON.stringify({ enabled, licensed, merged }));
  }
  await db.query(
    "insert into public.anime_license_aliases values($1,'Alias C')",
    [binder]
  );
  await same("license alias inserted");
  await db.query(
    "delete from public.anime_license_aliases where alias='Alias A'"
  );
  await same("license alias deleted");
  await db.query(
    "update public.anime_series_aliases set alias='Renamed Alias' where alias='Other Alias'"
  );
  await same("series alias renamed");
  await db.query(
    "update public.catalogue_binder_group_merges set source_license=null"
  );
  await db.query("delete from public.catalogue_binder_group_merges");
  await same("merge removed");
  await db.query("truncate public.anime_series_aliases");
  await same("series aliases truncated");
  await db.query(
    "update public.catalogue_binder_groups set display_name='New'"
  );
  await same("group renamed");

  // Players and the service role still cannot read aliases directly.
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec("set role " + role);
    for (const relation of [
      "public.active_binder_aliases",
      "public.active_binder_aliases_source",
      "public.binder_alias_cache"
    ])
      await assert.rejects(
        () => db.query(`select * from ${relation}`),
        /permission denied/,
        `${role} on ${relation}`
      );
    await db.exec("reset role");
  }
  const { rows: acl } = await db.query(
    "select has_function_privilege('authenticated','public.refresh_binder_alias_cache()','EXECUTE') as auth"
  );
  assert.deepEqual(acl, [{ auth: false }]);
});
