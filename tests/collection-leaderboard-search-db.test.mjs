import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("Top 100, literal username search and accepted-friend scope retain global ranks and visibility guards", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(`insert into auth.users(id,raw_user_meta_data)
    select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      jsonb_build_object('pseudo','RankSearch'||lpad(n::text,3,'0'))
    from generate_series(1,155) n`);
  const cards = {};
  for (const rarity of ["LR", "SR"])
    cards[rarity] = (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA',$2,'https://example.test/card.png','test') returning id",
        [`rank-search-${rarity}`, rarity]
      )
    ).rows[0].id;
  await db.query(
    `insert into public.user_cards(user_id,card_id,rarity)
    select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      case when n<=120 or n>151 then $1::uuid else $2::uuid end,
      case when n<=120 or n>151 then 'LR'::public.card_rarity else 'SR'::public.card_rarity end
    from generate_series(1,155) n where n<>151`,
    [cards.LR, cards.SR]
  );
  for (const friend of [110, 150, 152, 153, 154, 155])
    await db.query(
      "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
      [id(1), id(friend)]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($2,$1,'accepted'),($1,$3,'pending')",
    [id(1), id(125), id(149)]
  );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(152)]
  );
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [id(153)]
  );
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [id(154)]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($2,$1)",
    [id(1), id(155)]
  );
  const read = async (
    query = "",
    friendsOnly = false,
    offset = 0,
    limit = 100,
    viewer = 1
  ) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(viewer)
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          "select public.get_collection_leaderboard($1,$2,$3,$4) value",
          [offset, limit, query, friendsOnly]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const top = await read();
  assert.equal(top.entries.length, 100);
  assert.equal(top.total, 100);
  assert.equal(top.rankedPlayers, 151);
  assert.equal(top.limit, 100);
  assert.equal(top.entries[0].pseudo, "RankSearch001");
  assert.equal(top.entries[99].pseudo, "RankSearch100");
  assert.equal(
    top.entries.some(e => e.userId === id(150)),
    false
  );
  assert.equal((await read("", false, 100)).entries.length, 0);

  const found = await read("  rAnKsEaRcH150  ");
  assert.equal(found.query, "rAnKsEaRcH150");
  assert.equal(found.total, 1);
  assert.equal(found.entries[0].userId, id(150));
  assert.equal(found.entries[0].position, 122);
  assert.equal(found.entries[0].score, 100);
  assert.equal(found.entries[0].isFriend, true);
  assert.equal(found.mine.position, top.mine.position);
  const all = await read("RankSearch");
  assert.equal(all.total, 150);
  assert.equal(all.entries.length, 100);
  assert.equal((await read("RankSearch", false, 100)).entries.length, 50);
  assert.equal((await read("RankSearch130")).entries[0].position, 122);
  for (const query of [
    "%",
    "_",
    "' OR true --",
    "RankSearch151",
    "RankSearch152",
    "RankSearch153",
    "RankSearch154",
    "RankSearch155"
  ]) {
    assert.equal((await read(query)).total, 0, query);
  }

  const friends = await read("", true);
  assert.equal(friends.friendsOnly, true);
  assert.deepEqual(
    friends.entries.map(e => e.userId),
    [id(1), id(110), id(125), id(150)]
  );
  assert.deepEqual(
    friends.entries.map(e => e.position),
    [1, 1, 122, 122]
  );
  assert.deepEqual(
    friends.entries.map(e => e.isFriend),
    [false, true, true, true]
  );
  assert.equal((await read("RankSearch130", true)).total, 0);
  assert.equal((await read("RankSearch149", true)).total, 0);
  assert.equal((await read("RankSearch150", true)).entries[0].position, 122);
  assert.equal((await read("RankSearch", false, -50, 9999)).limit, 100);
  assert.equal((await read("RankSearch", false, -50, 9999)).offset, 0);
  assert.equal((await read("x".repeat(100))).query.length, 64);

  await assert.rejects(read("", false, 0, 100, 153), /ACCOUNT_BANNED/);
  await assert.rejects(read("", false, 0, 100, 154), /PROFILE_MISSING/);
  await assert.rejects(
    db.query("select public.get_collection_leaderboard(0,100,'',false)"),
    /AUTH_REQUIRED/
  );
  for (const role of ["anon", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select public.get_collection_leaderboard(0,100,'',false)"),
      /permission denied/
    );
    await db.exec("reset role");
  }
});
