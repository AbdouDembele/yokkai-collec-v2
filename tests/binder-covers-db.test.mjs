import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("binder pages return catalogue covers for unowned cards without changing progress, pagination or privacy", async t => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migration = "20261030200000_binder_cover_images.sql";
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(n => n.endsWith(".sql") && n < migration)
      .sort()
  });
  t.after(() => db.close());
  const viewer = "bd800000-0000-4000-8000-000000000001",
    privateUser = "bd800000-0000-4000-8000-000000000002";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data)values($1,$3),($2,$4)",
    [
      viewer,
      privateUser,
      '{"pseudo":"CoverViewer"}',
      '{"pseudo":"CoverPrivate"}'
    ]
  );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [privateUser]
  );
  await db.exec(
    "update public.anime_series_settings set enabled=true,license_grouping_enabled=true"
  );
  await db.exec(
    "insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url)values" +
      "('manual','cover-empty','Cover empty','Cover Pair','ANIME/MANGA','LR','')," +
      "('manual','cover-good','Cover good','Cover Pair','ANIME/MANGA','SR','https://example.test/good.png')," +
      "('manual','cover-other','Cover other','Cover Pair','VIDEO GAMES','LR','https://example.test/other.png')"
  );
  await db.exec(
    "insert into public.card_franchises(card_id,franchise,position)select id,'Secondary Cover',2 from public.cards where source_id='cover-good'"
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  const signatures = [
    "public.get_binder_albums_page(uuid,text,text,boolean,integer,integer)",
    "public.get_panini_albums_page(text,text,integer,integer,boolean)"
  ];
  const contracts = async () =>
    (
      await db.query(
        "select oid::regprocedure::text,prosecdef,provolatile,proconfig,proacl::text from pg_proc where oid=any($1::regprocedure[])order by oid",
        [signatures]
      )
    ).rows;
  const contract = await contracts();
  const value = async (sql, args = []) =>
    (await db.query(sql, args)).rows[0].value;
  const stable = (offset = 0, limit = 72) =>
    value("select public.get_binder_albums_page(null,'','',false,$1,$2)value", [
      offset,
      limit
    ]);
  const legacy = () => value("select public.get_panini_albums_page()value");
  await db.exec("set role authenticated");
  const beforeStable = await stable(),
    beforeLegacy = await legacy();
  await db.exec("reset role");
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.deepEqual(await contracts(), contract);
  await db.exec("set role authenticated");
  const afterStable = await stable(),
    afterLegacy = await legacy();
  const omitImages = page => ({
    ...page,
    items: page.items.map(({ image, ...rest }) => rest)
  });
  assert.deepEqual(omitImages(afterStable), beforeStable);
  assert.deepEqual(omitImages(afterLegacy), beforeLegacy);
  assert(afterStable.items.every(item => item.owned === 0 && item.image));
  const key = category =>
    "source:" +
    createHash("sha256")
      .update(category + "\x1fCover Pair")
      .digest("hex");
  assert.equal(
    afterStable.items.find(item => item.binderKey === key("ANIME/MANGA")).image,
    "https://example.test/good.png"
  );
  assert.equal(
    afterStable.items.find(item => item.binderKey === key("VIDEO GAMES")).image,
    "https://example.test/other.png"
  );
  assert.equal(
    afterStable.items.find(item => item.license === "Secondary Cover").image,
    "https://example.test/good.png"
  );
  assert.equal(
    afterLegacy.items.find(item => item.license === "Secondary Cover").image,
    "https://example.test/good.png"
  );
  const single = await stable(1, 1);
  assert.deepEqual(single.items, [afterStable.items[1]]);
  await assert.rejects(
    value("select public.get_binder_albums_page($1)value", [privateUser]),
    /PROFILE_PRIVATE/
  );
  await db.exec("set role anon");
  await assert.rejects(stable(), /permission denied|AUTH_REQUIRED/i);
});
