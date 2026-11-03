import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const uid = n => `8b100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cid = n => `8b200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("pack favorites match canonical binders, secondary licenses and explicit choices, never another player", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`alter table auth.users add column if not exists banned_until timestamptz;
 insert into auth.users(id,raw_user_meta_data) values ('${uid(1)}','{"pseudo":"FavoriteOwner"}'),('${uid(2)}','{"pseudo":"OtherOwner"}');
 update public.anime_series_settings set enabled=true,license_grouping_enabled=true;
 insert into public.cards(id,source_id,source,nom,franchise,categorie,rarete_base,image_url) values
 ('${cid(1)}','fav-one','manual','Alpha One','Favorite Alpha','ANIME/MANGA','SR','https://example.test/one.png'),
 ('${cid(2)}','fav-two','manual','Beta','Other Beta','ANIME/MANGA','C','https://example.test/two.png'),
 ('${cid(3)}','fav-three','manual','Same title, different category','Favorite Alpha','VIDEO GAMES','R','https://example.test/three.png'),
 ('${cid(4)}','fav-four','manual','Secondary Alpha','Other Beta','ANIME/MANGA','SSR','https://example.test/four.png'),
 ('${cid(5)}','fav-five','manual','Literal title','Favorite Alpha Remix','ANIME/MANGA','C','https://example.test/five.png');
 insert into public.card_franchises values('${cid(4)}','Favorite Alpha',1);
 `);
  const key = async (id, category) =>
    (
      await db.query(
        "select binder_key from public.catalogue_binder_links where card_id=$1 and category=$2 and source_license='Favorite Alpha'",
        [id, category]
      )
    ).rows[0].binder_key;
  const alpha = await key(cid(1), "ANIME/MANGA");
  const claim = async n =>
    db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(n)]);
  const read = async (
    ids = [cid(1), cid(2), cid(3), cid(4), cid(5)],
    stable = true
  ) =>
    (
      await db.query("select public.get_pack_favorite_card_ids($1,$2) ids", [
        ids,
        stable
      ])
    ).rows[0].ids.sort();
  await claim(1);
  await db.query("select public.set_binder_favorite($1,true)", [alpha]);
  assert.deepEqual(await read(), [cid(1), cid(4)]);
  await claim(2);
  assert.deepEqual(await read(), []);
  await claim(1);
  await db.query(
    "insert into public.panini_album_favorites values($1,'Favorite Alpha')",
    [uid(1)]
  );
  await db.query("select public.set_binder_favorite($1,false)", [alpha]);
  assert.deepEqual(
    await read(),
    [],
    "explicit removal defeats legacy favorite"
  );
  await db.query("select public.set_binder_favorite($1,true)", [alpha]);
  const group = "8b300000-0000-4000-8000-000000000001";
  await db.query(
    "insert into public.catalogue_binder_groups values($1,'Merged Favorite',true)",
    [group]
  );
  await db.query(
    "insert into public.catalogue_binder_group_merges(old_key,group_id) values($1,$2)",
    [alpha, group]
  );
  assert.deepEqual(await read(), [cid(1), cid(4)]);
  await db.query("select public.set_binder_favorite($1,false)", [
    "series:" + group
  ]);
  assert.deepEqual(await read(), []);
  await db.query("select public.set_binder_favorite($1,true)", [
    "series:" + group
  ]);
  for (const enabled of [true, false]) {
    await db.query(
      "update public.anime_series_settings set license_grouping_enabled=$1",
      [enabled]
    );
    const albums = (
      await db.query(
        "select public.get_binder_albums_page(null,'','',true,0,72) result"
      )
    ).rows[0].result;
    const keys = albums.items.map(a => a.binderKey);
    const expected = (
      await db.query(
        "select distinct card_id from public.catalogue_binder_links where binder_key=any($1::text[]) and card_id=any($2::uuid[]) order by card_id",
        [keys, [cid(1), cid(2), cid(3), cid(4), cid(5)]]
      )
    ).rows.map(r => r.card_id);
    assert.deepEqual(
      await read(),
      expected,
      "same favorite rules as the binder screen"
    );
  }
  assert.deepEqual(
    await read(undefined, false),
    [cid(1), cid(3), cid(4)],
    "legacy mode includes every exact secondary license across categories"
  );
  assert.deepEqual(await read([]), []);
  assert.deepEqual(await read([null, cid(1), cid(1)]), [cid(1)]);
  await assert.rejects(read(Array(501).fill(cid(1))), /INVALID_CARD_SELECTION/);
  await db.exec(
    `update auth.users set banned_until='infinity' where id='${uid(1)}'`
  );
  await assert.rejects(read(), /ACCOUNT_BANNED/);
  await db.exec("set role anon");
  await assert.rejects(read(), /permission denied/i);
  await db.exec("reset role;set role service_role");
  await assert.rejects(read(), /permission denied/i);
  await db.exec("reset role");
  assert.equal(
    (await db.query("select count(*)::int n from public.user_cards")).rows[0].n,
    0,
    "the reader never awards a copy"
  );
});
test("favorite membership is not truncated at one page of 72 favorites", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id,raw_user_meta_data) values('${uid(1)}','{"pseudo":"ManyFavorites"}');
 insert into public.cards(id,source_id,source,nom,franchise,categorie,rarete_base,image_url) select ('8b200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'many-fav-'||n,'manual','Favorite Card '||n,'Many Favorite '||n,'ANIME/MANGA','C','https://example.test/many.png' from generate_series(1,80)n;
 insert into public.panini_album_favorites(user_id,license) select '${uid(1)}','Many Favorite '||n from generate_series(1,80)n;
 select set_config('request.jwt.claim.sub','${uid(1)}',false);`);
  const ids = Array.from({ length: 80 }, (_, i) => cid(i + 1));
  const rows = (
    await db.query("select public.get_pack_favorite_card_ids($1,true) ids", [
      ids
    ])
  ).rows[0].ids;
  assert.equal(rows.length, 80);
  assert(rows.includes(cid(80)));
  assert.deepEqual(
    (await db.query("select public.get_pack_favorite_card_ids(null,true) ids"))
      .rows[0].ids,
    []
  );
});
