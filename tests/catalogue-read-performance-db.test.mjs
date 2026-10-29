import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261029020000_catalogue_metadata_read_performance.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);
const canonical = items =>
  items
    .map(item => ({
      ...item,
      binders: item.binders.sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b))
      )
    }))
    .sort((a, b) => a.card_id.localeCompare(b.card_id));

test("performance migration preserves binder metadata, aliases, limits, permissions and catalogue results", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(n => n.endsWith(".sql") && n < migration)
      .sort()
  });
  t.after(() => db.close());
  for (const name of [
    "get_card_binder_metadata",
    "get_binder_catalogue_page"
  ]) {
    const definition = (
      await db.query(
        "select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=$1",
        [name]
      )
    ).rows[0].definition;
    await db.exec(
      definition.replace(
        "public." + name + "(",
        "public.reference_" + name + "("
      )
    );
  }
  const properties = () =>
    db.query(
      "select proname,prosecdef,provolatile,proconfig,proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and proname in('get_card_binder_metadata','get_binder_catalogue_page')order by proname"
    );
  const before = (await properties()).rows;
  const owner = "f7100000-0000-4000-8000-000000000001",
    binder = "f7200000-0000-4000-8000-000000000001",
    group = "f7200000-0000-4000-8000-000000000002";
  await db.query(
    'insert into auth.users(id,raw_user_meta_data)values($1,\'{"pseudo":"Performance Fixture"}\')',
    [owner]
  );
  await db.query(
    "insert into public.anime_series_binders values($1,99001,'Performance Series')",
    [binder]
  );
  await db.query(
    "insert into public.anime_license_binders values($1,'Performance License')",
    [binder]
  );
  await db.query(
    "insert into public.anime_license_source_rules values('Performance Source',$1)",
    [binder]
  );
  await db.query(
    "insert into public.anime_license_aliases values($1,'Alias B'),($1,'Alias A')",
    [binder]
  );
  await db.query(
    "insert into public.anime_series_aliases values($1,'Legacy Alias')",
    [binder]
  );
  await db.query(
    "insert into public.catalogue_binder_groups values($1,'Editorial Merge',true)",
    [group]
  );
  await db.query(
    "insert into public.catalogue_binder_group_merges(old_key,group_id)values($1,$2)",
    ["series:" + binder, group]
  );
  const ids = [];
  for (let i = 0; i < 31; i++) {
    const id = "f7300000-0000-4000-8000-" + String(i + 1).padStart(12, "0");
    ids.push(id);
    await db.query(
      "insert into public.cards(id,source,source_id,nom,categorie,franchise,rarete_base,image_url)values($1,'test',$2,$3,$4,$5,$6,'https://example.test/performance.png')",
      [
        id,
        String(i),
        "Card " + String(i % 9).padStart(2, "0"),
        i % 3 ? "ANIME/MANGA" : "FILM",
        i % 3 ? "Performance Source" : "Other Source",
        ["C", "R", "SR", "SSR", "LR"][i % 5]
      ]
    );
  }
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position)values($1,'Secondary License',1)",
    [ids[1]]
  );
  await db.query("insert into public.wishlists(user_id,card_id)values($1,$2)", [
    owner,
    ids[1]
  ]);
  const cardSnapshot = (
    await db.query("select * from public.cards order by id")
  ).rows;
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual(
    (await properties()).rows,
    before,
    "No grant, security-definer, volatility or search_path changes"
  );
  assert.deepEqual(
    (await db.query("select * from public.cards order by id")).rows,
    cardSnapshot,
    "No catalogue data rewritten"
  );
  const inputs = [
    null,
    [],
    [ids[1]],
    [ids[1], ids[1], null],
    ids,
    Array(500).fill(ids[1]),
    Array(501).fill(ids[1]),
    ["00000000-0000-4000-8000-000000000000"]
  ];
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
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set role " + role);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        role === "anon" ? "" : owner
      ]);
      for (const input of inputs) {
        const result = (
          await db.query(
            "select public.get_card_binder_metadata($1::uuid[]) value,public.reference_get_card_binder_metadata($1::uuid[]) reference",
            [input]
          )
        ).rows[0];
        assert.deepEqual(canonical(result.value), canonical(result.reference));
      }
      const cases = [
        [],
        ["", "", "", 0, 4, "rarity"],
        ["", "", "", 4, 4, "rarity"],
        ["", "", "", 0, 60, "name"],
        [null, null, null, null, null, null],
        ["  ", '["ANIME/MANGA","FILM"]', '["LR","SR"]', 1, 60, "rarity"],
        ["", "UNKNOWN", "", 0, 24, "rarity"],
        ["", "", "", -4, 0, "other"],
        ["", "", "", 999, 100, "rarity"],
        ["Alias A", "", "", 0, 24, "rarity"],
        ["Card Source", "ANIME/MANGA", "", 0, 24, "rarity"],
        ["%", "", "", 0, 24, "rarity"],
        ["No matches", "", "", 0, 24, "rarity"]
      ];
      for (const args of cases) {
        const placeholders = args.map((_, i) => "$" + (i + 1)).join(",");
        const result = (
          await db.query(
            "select public.get_binder_catalogue_page(" +
              placeholders +
              ") value,public.reference_get_binder_catalogue_page(" +
              placeholders +
              ") reference",
            args
          )
        ).rows[0];
        assert.deepEqual(
          result.value,
          result.reference,
          JSON.stringify({ enabled, licensed, merged, role, args })
        );
      }
      if (role === "authenticated") {
        const listed = (
          await db.query(
            "select public.get_binder_catalogue_page('','','',0,60,'rarity') value"
          )
        ).rows[0].value;
        assert.equal(listed.items.find(c => c.id === ids[1]).wishlisted, true);
      }
      await assert.rejects(
        () => db.query("select * from public.active_binder_aliases"),
        /permission denied/
      );
      await db.exec("reset role");
    }
  }
});
