import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const id = n => `ab900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = (name, category = "ANIME/MANGA") =>
  "source:" +
  createHash("sha256")
    .update(category + "\x1f" + name)
    .digest("hex");
test("profile likes and license rankings preserve privacy, distinct progress, exact memberships and bounded competition ranks", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id,raw_user_meta_data)
    select ('ab900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    jsonb_build_object('pseudo','Rank'||lpad(n::text,3,'0')) from generate_series(1,130)n;
    alter table auth.users add column if not exists banned_until timestamptz;
    update public.anime_series_settings set enabled=true,license_grouping_enabled=true;
    insert into public.profile_likes(owner_id,user_id)
      select ('ab900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      ('ab900000-0000-4000-8000-'||lpad(v::text,12,'0'))::uuid
      from generate_series(1,125)n cross join lateral generate_series(127,
        case when n=1 then 129 when n in(2,3) then 128 when n in(4,5,6,7) then 130 else 127 end)v;
    insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url) values
      ('manual','rank-a1','Rank card 1','Ranking License','ANIME/MANGA','LR','https://example.test/a.png'),
      ('manual','rank-a2','Rank card 2','Ranking License','ANIME/MANGA','SR','https://example.test/a.png'),
      ('manual','rank-a3','Rank card 3','Ranking License','ANIME/MANGA','C','https://example.test/a.png'),
      ('manual','rank-secondary','Rank secondary','Another License','ANIME/MANGA','SSR','https://example.test/a.png'),
      ('manual','rank-game','Rank game','Ranking License','VIDEO GAMES','LR','https://example.test/a.png');
    insert into public.card_franchises(card_id,franchise,position) select id,'Ranking License',2 from public.cards where source_id='rank-secondary';
    insert into public.user_cards(user_id,card_id,rarity)
      select ('ab900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,c.id,c.rarete_base
      from generate_series(1,7)n cross join public.cards c where c.source_id like 'rank-%'
        and not(n in(2,3) and c.source_id='rank-a3');
    insert into public.user_cards(user_id,card_id,rarity,is_evolved)
      select '${id(1)}',id,rarete_base,true from public.cards where source_id='rank-a1';
    update public.user_profiles set is_public=false where user_id='${id(4)}';
    update auth.users set banned_until=now()+interval '1 day' where id='${id(5)}';
    insert into public.account_deletion_log(user_id) values('${id(6)}');
    insert into public.user_blocks(blocker_id,blocked_id) values('${id(7)}','${id(1)}');
    insert into public.friendships(user_id,friend_id,status) values('${id(1)}','${id(2)}','accepted'),('${id(3)}','${id(1)}','pending');`);
  const read = async (
    kind,
    {
      viewer = 1,
      query = "",
      friends = false,
      offset = 0,
      limit = 20,
      binder = key("Ranking License")
    } = {}
  ) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(viewer)
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          kind === "likes"
            ? "select public.get_profile_likes_leaderboard($1,$2,$3,$4) value"
            : "select public.get_license_leaderboard($5,$1,$2,$3,$4) value",
          kind === "likes"
            ? [offset, limit, query, friends]
            : [offset, limit, query, friends, binder]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const likes = await read("likes");
  assert.equal(likes.limit, 20);
  assert.equal(likes.rankedPlayers, 122);
  assert.equal(likes.total, 99); // Blocked #1 omitted from the global top 100.
  assert.deepEqual(
    likes.entries.slice(0, 3).map(e => [e.userId, e.value, e.position]),
    [
      [id(1), 3, 2],
      [id(2), 2, 3],
      [id(3), 2, 3]
    ]
  );
  assert.deepEqual(likes.mine, { value: 3, isPublic: true, position: 2 });
  assert.deepEqual(
    Object.keys(likes.entries[0]).sort(),
    ["avatarUrl", "isFriend", "position", "pseudo", "userId", "value"].sort()
  );
  assert.deepEqual(
    Object.keys(likes.profileStyles).sort(),
    likes.entries.map(e => e.userId).sort()
  );
  assert.equal((await read("likes", { query: "Rank125" })).entries[0].value, 1);
  assert.equal(
    (await read("likes", { query: "Rank125" })).entries[0].position,
    5
  );
  assert.equal((await read("likes", { query: "Rank" })).total, 121);
  assert.equal(
    (await read("likes", { query: "Rank", offset: 120 })).entries.length,
    1
  );
  for (const query of [
    "Rank004",
    "Rank005",
    "Rank006",
    "Rank007",
    "%",
    "_",
    "' OR true --"
  ])
    assert.equal((await read("likes", { query })).total, 0, query);
  assert.deepEqual(
    (await read("likes", { friends: true })).entries.map(e => e.userId),
    [id(1), id(2)]
  );
  assert.equal(
    (await read("likes", { friends: true, query: "Rank003" })).total,
    0
  );
  assert.deepEqual((await read("likes", { viewer: 4 })).mine, {
    value: 4,
    isPublic: false,
    position: null
  });
  assert.equal(
    (await read("likes", { viewer: 4 })).entries.some(e => e.userId === id(4)),
    false
  );
  assert.equal((await read("likes", { limit: 9999, offset: -2 })).limit, 100);
  assert.equal((await read("likes", { limit: 9999, offset: -2 })).offset, 0);
  assert.equal(
    (await read("likes", { query: "a".repeat(100) })).query.length,
    64
  );

  const license = await read("license");
  assert.equal(
    license.binder.total,
    4,
    "Secondary memberships count; homonymous game binder stays separate"
  );
  assert.deepEqual(
    license.entries.map(e => [e.userId, e.value, e.position]),
    [
      [id(1), 4, 1],
      [id(2), 3, 3],
      [id(3), 3, 3]
    ]
  );
  assert.deepEqual(license.mine, { value: 4, isPublic: true, position: 1 });
  assert.equal(
    (await read("license", { binder: key("Ranking License", "VIDEO GAMES") }))
      .binder.total,
    1
  );
  assert.equal(
    (await read("license", { binder: "Ranking License" })).binder.total,
    5,
    "Legacy reader retains exact secondary licenses"
  );
  assert.equal(
    (await read("license", { binder: key("Another License") })).entries[0]
      .value,
    1
  );
  assert.deepEqual(
    (await read("license", { friends: true })).entries.map(e => e.userId),
    [id(1), id(2)]
  );
  assert.equal(
    (await read("license", { query: "Rank003", offset: 999 })).entries.length,
    0
  );
  assert.equal(
    (await read("license", { query: "  rAnK003 " })).entries[0].position,
    3
  );
  assert.equal((await read("license", { viewer: 4 })).mine.position, null);
  for (const query of ["Rank004", "Rank005", "Rank006", "Rank007"])
    assert.equal((await read("license", { query })).total, 0, query);
  assert.equal((await read("license", { viewer: 130 })).mine.value, 0);

  // Merge identities and current catalogue membership are resolved live, never by substring.
  const group = "ab900000-0000-4000-8000-000000000200";
  await db.query(
    "insert into public.catalogue_binder_groups(id,display_name,enabled) values($1,'Merged Ranking',true)",
    [group]
  );
  await db.query(
    "insert into public.catalogue_binder_group_merges(old_key,group_id) values($1,$2),($3,$2)",
    [key("Ranking License"), group, key("Another License")]
  );
  const merged = await read("license");
  assert.equal(merged.binder.key, "series:" + group);
  assert.equal(
    merged.binder.total,
    4,
    "A secondary membership and merged primary are one card"
  );
  assert.equal(merged.mine.value, 4);
  await db.query(
    "delete from public.user_cards where user_id=$1 and card_id in(select id from public.cards where source_id='rank-secondary')",
    [id(1)]
  );
  assert.equal(
    (await read("license")).mine.value,
    3,
    "Lost copies no longer count"
  );
  assert.equal((await read("license")).mine.position, 2);
  await db.query(
    "delete from public.profile_likes where owner_id=$1 and user_id=$2",
    [id(1), id(129)]
  );
  assert.equal(
    (await read("likes")).mine.value,
    2,
    "Unlikes update the ranking without historical points"
  );

  for (const kind of ["likes", "license"]) {
    await assert.rejects(read(kind, { viewer: 5 }), /ACCOUNT_BANNED/);
    await assert.rejects(read(kind, { viewer: 6 }), /PROFILE_MISSING/);
    const call =
      kind === "likes"
        ? "select public.get_profile_likes_leaderboard()"
        : "select public.get_license_leaderboard('Ranking License')";
    await assert.rejects(db.query(call), /AUTH_REQUIRED/);
    for (const role of ["anon", "service_role"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query(call), /permission denied/);
      await db.exec("reset role");
    }
  }
  await assert.rejects(read("license", { binder: "" }), /BINDER_KEY_REQUIRED/);
  for (const kind of ["likes", "license"]) {
    await read(kind, { viewer: 130 });
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(130)
    ]);
    await db.exec("set role authenticated");
    for (const table of ["profile_likes", "catalogue_binder_links"])
      await assert.rejects(
        db.query(`select * from public.${table}`),
        /permission denied/
      );
    await db.exec("reset role");
  }
});
