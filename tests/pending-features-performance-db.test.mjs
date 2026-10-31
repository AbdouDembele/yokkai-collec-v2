import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("performance migration and rollback preserve exact catalogue, ranking payloads and function privileges", async t => {
  const migration = "20261031120000_pending_features_performance.sql";
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const { db } = await replayMigrations({
    migrations: readdirSync(dir)
      .filter(n => n.endsWith(".sql") && n < migration)
      .sort()
  });
  t.after(() => db.close());
  const viewer = "bf310000-0000-4000-8000-000000000001",
    friend = "bf310000-0000-4000-8000-000000000002",
    group = "bf310000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [viewer, "PerfViewer"],
    [friend, "PerfFriend"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.exec(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true"
  );
  await db.exec(
    "insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url)values ('manual','perf-1','First','Performance Alpha','ANIME/MANGA','LR','https://example.test/one.png'),('manual','perf-2','Second','Performance Beta','ANIME/MANGA','C','https://example.test/two.png'),('manual','perf-3','Other category','Performance Alpha','VIDEO GAMES','SR','https://example.test/three.png')"
  );
  await db.exec(
    "insert into public.card_franchises(card_id,franchise,position) select id,'Performance Beta',1 from public.cards where source_id='perf-1'"
  );
  const key = (category, name) =>
    "source:" +
    createHash("sha256")
      .update(category + "\x1f" + name)
      .digest("hex");
  await db.query(
    "insert into public.catalogue_binder_groups(id,display_name,enabled)values($1,'Merged Performance',true)",
    [group]
  );
  await db.query(
    "insert into public.catalogue_binder_group_merges(old_key,group_id)values($1,$3),($2,$3)",
    [
      key("ANIME/MANGA", "Performance Alpha"),
      key("ANIME/MANGA", "Performance Beta"),
      group
    ]
  );
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity)select $1,id,rarete_base from public.cards",
    [viewer]
  );
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity,is_shiny)select $1,id,rarete_base,true from public.cards where source_id='perf-1'",
    [viewer]
  );
  await db.query(
    "insert into public.profile_likes(owner_id,user_id)values($1,$2)",
    [viewer, friend]
  );
  await db.query(
    "insert into public.leaderboard_rank_observations values($1,'likes',current_date-7,3)",
    [viewer]
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  const calls = [
    "select public.get_binder_albums_page() value",
    "select public.get_ranking_license_choices() value",
    "select public.get_ranking_license_choices('Performance','VIDEO GAMES','p',true,0,72) value",
    "select public.get_ranking_license_choices('','','',false,0,72) value",
    "select public.get_profile_likes_leaderboard() value",
    "select public.get_license_leaderboard('global:progress-score') value",
    "select public.get_license_leaderboard('global:progress-score:legacy') value",
    "select public.get_license_leaderboard('series:" + group + "') value",
    "select public.get_license_leaderboard('" +
      key("ANIME/MANGA", "Performance Beta") +
      "') value",
    "select public.get_license_leaderboard('" +
      key("VIDEO GAMES", "Performance Alpha") +
      "') value"
  ];
  const read = async () => {
    await db.exec("set role authenticated");
    try {
      return await Promise.all(
        calls.map(async sql => (await db.query(sql)).rows[0].value)
      );
    } finally {
      await db.exec("reset role");
    }
  };
  const contracts = async () =>
    (
      await db.query(
        "select proname,prosecdef,provolatile,proconfig,proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in('get_binder_albums_page','get_ranking_license_choices','get_license_leaderboard','with_leaderboard_history')order by proname"
      )
    ).rows;
  const before = await read(),
    permissions = await contracts();
  assert.equal(
    before[7].binder.total,
    2,
    "Merged primary and secondary names count each identity once"
  );
  await db.exec(
    "create temporary table reference_links as select * from public.catalogue_binder_links"
  );
  await db.exec(readFileSync(new URL(migration, dir), "utf8"));
  assert.deepEqual(await read(), before);
  assert.deepEqual(await contracts(), permissions);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from((select * from public.catalogue_binder_links except all select * from reference_links)union all(select * from reference_links except all select * from public.catalogue_binder_links))d"
      )
    ).rows[0].n,
    0
  );
  await db.exec(
    readFileSync(
      new URL(
        "../docs/rollback/pending-features-performance.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.deepEqual(await read(), before);
  assert.deepEqual(await contracts(), permissions);
});
