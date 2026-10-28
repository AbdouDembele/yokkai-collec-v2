import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("Home keeps its friend audience while public wall reactions follow option C", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const users = Array.from(
    { length: 7 },
    (_, i) => `79010000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  const [viewer, friend, reverse, stranger, pending, banned, deleted] = users;
  for (const [i, id] of users.entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `OwnFeedPlayer${i}` })]
    );
    await db.query(
      "insert into public.user_profiles(user_id,pseudo,is_public) values($1,$2,false) on conflict(user_id) do update set is_public=false",
      [id, `OwnFeedPlayer${i}`]
    );
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body,created_at) values($1,$2,$3,now()-interval '1 hour')",
      [id, id, `Post ${i}`]
    );
  }
  for (const id of [friend, banned, deleted])
    await db.query(
      "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
      [viewer, id]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [reverse, viewer]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'pending')",
    [viewer, pending]
  );
  await db.query(
    "update public.user_profiles set is_public=true where user_id in ($1,$2)",
    [stranger, pending]
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [banned]
  );
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [deleted]
  );
  const login = async (id, role = "authenticated") => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? ""
    ]);
  };
  const feed = async (cursor = null, limit = 10) =>
    (
      await db.query("select public.get_home_wall_feed($1,$2,$3) value", [
        cursor?.at ?? null,
        cursor?.id ?? null,
        limit
      ])
    ).rows[0].value;
  const react = async (post, emoji, state) =>
    (
      await db.query("select public.set_wall_post_reaction($1,$2,$3) value", [
        post,
        emoji,
        state
      ])
    ).rows[0].value;
  for (const role of ["anon", "service_role"]) {
    await login(viewer, role);
    await assert.rejects(feed(), /permission denied/);
  }
  await login(null);
  await assert.rejects(feed(), /AUTH_REQUIRED/);
  await login(viewer);
  await assert.rejects(
    feed({ at: "2026-10-21T12:00:00Z" }),
    /FEED_CURSOR_INVALID/
  );
  let page = await feed(null, 2);
  const all = [...page.items];
  while (page.next) {
    page = await feed(page.next, 2);
    all.push(...page.items);
  }
  assert.deepEqual(
    all.map(post => post.author.id),
    [reverse, friend, viewer]
  );
  assert.equal(new Set(all.map(post => post.id)).size, 3);
  assert.equal((await feed(null, -1)).items.length, 1);
  assert.ok(all.every(post => !("mediaPath" in post)));
  const eggplant = (await react(friend, "eggplant", true)).reactions.find(
    item => item.emoji === "eggplant"
  );
  assert.deepEqual(eggplant, {
    emoji: "eggplant",
    count: 1,
    reactedByMe: true
  });
  assert.equal(
    (await react(friend, "eggplant", true)).reactions.find(
      item => item.emoji === "eggplant"
    ).count,
    1
  );
  assert.deepEqual((await react(friend, "eggplant", false)).reactions, []);
  await react(viewer, "eggplant", true);
  assert.equal(
    (await react(stranger, "eggplant", true)).reactions[0].reactedByMe,
    true
  );
  await react(stranger, "eggplant", false);
  await assert.rejects(
    react(friend, "not-an-emoji", true),
    /WALL_REACTION_INVALID/
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [friend, viewer]
  );
  await db.query("delete from public.friendships where user_id=$1", [reverse]);
  await login(viewer);
  assert.deepEqual(
    (await feed()).items.map(post => post.author.id),
    [viewer]
  );
  await assert.rejects(
    react(friend, "eggplant", true),
    /WALL_POST_UNAVAILABLE/
  );
  const publishedId = "79010000-0000-4000-9000-000000000001";
  await db.query("select public.publish_profile_wall_post($1,$2,null,null)", [
    publishedId,
    "Published from Home"
  ]);
  assert.ok(
    (await feed()).items.some(
      post =>
        post.id === publishedId &&
        post.author.id === viewer &&
        post.text === "Published from Home"
    )
  );
  await db.exec("reset role");
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [viewer]
  );
  await login(viewer);
  await assert.rejects(feed(), /AUTH_REQUIRED/);
  await db.exec("reset role");
  await db.query("update auth.users set banned_until=null where id=$1", [
    viewer
  ]);
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [viewer]
  );
  await login(viewer);
  await assert.rejects(feed(), /AUTH_REQUIRED/);
});
