import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("public timeline and batch activity preserve the existing wall rights", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column banned_until timestamptz");
  const id = n => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [owner, friend, stranger, privateOwner, banned, deleting] = [
    1, 2, 3, 4, 5, 6
  ].map(id);
  for (const [n, user] of [
    owner,
    friend,
    stranger,
    privateOwner,
    banned,
    deleting
  ].entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `PublicFeed${n}` })]
    );
    await db.query(
      "insert into public.user_profiles(user_id,pseudo,is_public) values($1,$2,true) on conflict(user_id) do update set is_public=true",
      [user, `PublicFeed${n}`]
    );
  }
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [privateOwner]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted'),($2,$3,'accepted')",
    [owner, friend, privateOwner]
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [banned]
  );
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [deleting]
  );
  for (let n = 100; n < 145; n++)
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body,created_at) values($1,$2,'Story','2026-10-25T00:00:00Z')",
      [id(n), owner]
    );
  for (const [n, user] of [
    [150, privateOwner],
    [151, banned],
    [152, deleting],
    [153, friend],
    [154, stranger]
  ])
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'Other story')",
      [id(n), user]
    );
  await db.query(
    "insert into public.wall_post_likes(post_id,user_id) values($1,$2)",
    [id(100), friend]
  );
  await db.query(
    "insert into public.wall_post_reactions(post_id,user_id,emoji) values($1,$2,'heart')",
    [id(100), friend]
  );
  for (let n = 200; n < 212; n++)
    await db.query(
      "insert into public.wall_post_replies(id,post_id,user_id,body) values($1,$2,$3,'Reply')",
      [id(n), id(100), friend]
    );
  const login = async user => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const root = () => db.exec("reset role");
  const feed = async (cursor = null, limit = 20) =>
    (
      await db.query("select public.get_public_wall_feed($1,$2,$3) value", [
        cursor?.at ?? null,
        cursor?.id ?? null,
        limit
      ])
    ).rows[0].value;
  const batch = async ids =>
    (
      await db.query(
        "select public.get_wall_posts_activity($1::uuid[]) value",
        [ids]
      )
    ).rows[0].value;
  const unit = async key =>
    (await db.query("select public.get_wall_post_activity($1) value", [key]))
      .rows[0].value;
  await login(friend);
  const all = [];
  let cursor = null;
  do {
    const page = await feed(cursor);
    all.push(...page.items);
    cursor = page.next;
  } while (cursor);
  assert.equal(all.length, 47);
  assert.equal(new Set(all.map(p => p.id)).size, 47);
  assert.ok(
    all.every(p => ![privateOwner, banned, deleting].includes(p.author.id))
  );
  assert.deepEqual(
    all.filter(p => p.author.id === owner).map(p => p.id),
    Array.from({ length: 45 }, (_, n) => id(144 - n))
  );
  assert.equal((await feed(null, 999)).items.length, 20);
  assert.equal((await feed(null, 0)).items.length, 1);
  assert.equal((await feed(null, null)).items.length, 10);
  await assert.rejects(
    db.query("select public.get_public_wall_feed(now(),null)"),
    /FEED_CURSOR_INVALID/
  );
  await assert.rejects(
    db.query("select public.get_public_wall_feed(null,$1)", [id(100)]),
    /FEED_CURSOR_INVALID/
  );
  await root();
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  await login(friend);
  assert.ok((await feed()).items.every(p => p.author.id !== owner));
  await root();
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [owner]
  );
  for (const [a, b] of [
    [friend, owner],
    [owner, friend]
  ]) {
    await db.query(
      "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
      [a, b]
    );
    await login(friend);
    assert.ok((await feed()).items.every(p => p.author.id !== owner));
    assert.deepEqual(await batch([id(100)]), {});
    await root();
    await db.exec("delete from public.user_blocks");
  }
  // Four matrix readers: self, accepted friend, public stranger, private stranger.
  for (const [reader, post, allowed] of [
    [owner, id(100), true],
    [friend, id(100), true],
    [stranger, id(100), true],
    [stranger, id(150), false]
  ]) {
    await login(reader);
    const result = await batch([post, id(999)]);
    if (allowed) {
      assert.deepEqual(result[post], await unit(post));
      if (post === id(100)) {
        assert.equal(result[post].items.length, 10);
        assert.ok(result[post].next);
        assert.equal(result[post].likes, 1);
        assert.equal(result[post].reactions.length, 1);
      }
    } else {
      assert.deepEqual(result, {});
      await assert.rejects(unit(post), /WALL_POST_UNAVAILABLE/);
    }
    assert.equal(result[id(999)], undefined);
  }
  await login(friend);
  assert.deepEqual(await batch([]), {});
  assert.deepEqual(await batch([null]), {});
  assert.equal(Object.keys(await batch([id(100), id(100)])).length, 1);
  await assert.rejects(batch(Array(21).fill(id(100))), /WALL_ACTIVITY_LIMIT/);
  await db.exec("reset role; set role anon");
  await assert.rejects(feed(), /permission denied/);
  await assert.rejects(batch([]), /permission denied/);
  await login("");
  await assert.rejects(feed(), /AUTH_REQUIRED/);
  await assert.rejects(batch([]), /AUTH_REQUIRED/);
  await root();
  // PERF-04 style: inspect relation size, then prove ordered index eligibility.
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body,created_at) select gen_random_uuid(),$1,'Synthetic size fixture',now()-n*interval '1 second' from generate_series(1,10000) n",
    [owner]
  );
  await db.exec("analyze public.profile_wall_posts");
  const size = (
    await db.query(
      "select count(*)::int rows,pg_relation_size('public.profile_wall_posts') heap_bytes,pg_indexes_size('public.profile_wall_posts') index_bytes,pg_total_relation_size('public.profile_wall_posts') total_bytes from public.profile_wall_posts"
    )
  ).rows[0];
  await db.exec("set enable_seqscan=off");
  const plan = (
    await db.query(
      "explain (format json) select id from public.profile_wall_posts where (created_at,id)<('2030-01-01', 'ffffffff-ffff-ffff-ffff-ffffffffffff') order by created_at desc,id desc limit 21"
    )
  ).rows;
  assert.match(JSON.stringify(plan), /Index (Only )?Scan/);
  assert.match(JSON.stringify(plan), /profile_wall_posts_timeline/);
  assert.doesNotMatch(JSON.stringify(plan), /"Node Type":"Sort"/);
  console.log(
    "Timeline EXPLAIN and synthetic size",
    JSON.stringify({ size, plan })
  );
});
