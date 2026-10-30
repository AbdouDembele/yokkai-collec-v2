import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("association merges preserve the parent, other categories, secondary links, and private write access", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const parent = "9a300000-0000-4000-8000-000000000001";
  const target = "9a300000-0000-4000-8000-000000000002";
  const oldTarget = "9a300000-0000-4000-8000-000000000003";
  const id = n => `9a310000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await db.exec(`
    update public.anime_series_settings set enabled=true,license_grouping_enabled=true;
    insert into public.anime_series_binders values ('${parent}',1900300001,'Scoped parent fixture');
    insert into public.anime_license_binders values ('${parent}','Scoped parent fixture');
    insert into public.anime_license_source_rules values
      ('Scoped title A','${parent}'),('Scoped title B','${parent}');
    insert into public.catalogue_binder_groups values
      ('${target}','Exact destination fixture',true),
      ('${oldTarget}','Existing redirect fixture',true);
    insert into public.cards(id,source_id,source,nom,categorie,franchise,rarete_base,image_url) values
      ('${id(1)}','scoped-fixture-1','anilist','Scoped A','ANIME/MANGA','Scoped title A','C','https://example.com/a.png'),
      ('${id(2)}','scoped-fixture-2','anilist','Scoped B','ANIME/MANGA','Scoped title B','C','https://example.com/b.png'),
      ('${id(3)}','scoped-fixture-3','anilist','Other category','VIDEO GAMES','Scoped title A','C','https://example.com/c.png');
  `);
  const links = async () =>
    (
      await db.query(`select card_id,category,source_license,binder_key,display_name
    from public.catalogue_binder_links where card_id in ('${id(1)}','${id(2)}','${id(3)}')
    order by card_id,source_license`)
    ).rows;
  const before = await links();
  assert.equal(
    before.find(r => r.card_id === id(1)).binder_key,
    "series:" + parent
  );
  assert.equal(
    before.find(r => r.card_id === id(2)).binder_key,
    "series:" + parent
  );
  await db.query(
    "insert into public.catalogue_binder_group_merges values($1,$2,$3,$4)",
    ["series:" + parent, oldTarget, null, null]
  );
  const global = await links();
  assert.equal(
    global.find(r => r.card_id === id(1)).binder_key,
    "series:" + oldTarget
  );
  assert.equal(
    global.find(r => r.card_id === id(2)).binder_key,
    "series:" + oldTarget
  );
  await db.query(
    "insert into public.catalogue_binder_source_merges values($1,$2,$3)",
    ["ANIME/MANGA", "Scoped title A", target]
  );
  const scoped = await links();
  assert.equal(
    scoped.find(r => r.card_id === id(1)).binder_key,
    "series:" + target
  );
  assert.deepEqual(
    scoped.find(r => r.card_id === id(2)),
    global.find(r => r.card_id === id(2))
  );
  assert.deepEqual(
    scoped.find(r => r.card_id === id(3)),
    before.find(r => r.card_id === id(3))
  );
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values($1,$2,$3)",
    [id(1), "Scoped title B", 1]
  );
  const secondary = (await links()).filter(r => r.card_id === id(1));
  assert.equal(secondary.length, 2);
  assert.equal(
    secondary.find(r => r.source_license === "Scoped title A").binder_key,
    "series:" + target
  );
  assert.equal(
    secondary.find(r => r.source_license === "Scoped title B").binder_key,
    "series:" + oldTarget
  );
  await db.query(
    "update public.catalogue_binder_groups set enabled=false where id=$1",
    [target]
  );
  assert.equal(
    (await links()).find(
      r => r.card_id === id(1) && r.source_license === "Scoped title A"
    ).binder_key,
    "series:" + oldTarget
  );
  const state = (
    await db.query(`select relrowsecurity from pg_class
    where oid='public.catalogue_binder_source_merges'::regclass`)
  ).rows[0];
  assert.equal(state.relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const row = (
        await db.query("select has_table_privilege($1,$2,$3) allowed", [
          role,
          "public.catalogue_binder_source_merges",
          privilege
        ])
      ).rows[0];
      assert.equal(row.allowed, false, `${role}: ${privilege}`);
    }
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.cards where id=any($1::uuid[])",
        [[id(1), id(2), id(3)]]
      )
    ).rows[0].n,
    3
  );
});
