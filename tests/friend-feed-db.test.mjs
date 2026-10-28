import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("friend wall feed is bounded, stable and follows live friendship/privacy ACLs", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const users = Array.from(
    { length: 8 },
    (_, i) => `79000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  const [viewer, friend, reverse, stranger, pending, blocked, banned, deleted] =
    users;
  for (const [i, id] of users.entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `FeedPlayer${i}` })]
    );
    await db.query(
      "insert into public.user_profiles(user_id,pseudo,is_public) values($1,$2,false) on conflict(user_id) do update set is_public=false",
      [id, `FeedPlayer${i}`]
    );
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body,created_at) values($1,$2,$3,'2026-10-20T12:00:00Z')",
      [id, id, `Post ${i}`]
    );
  }
  for (const id of [friend, blocked, banned, deleted])
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
    [pending, viewer]
  );
  await db.query(
    "update public.user_profiles set is_public=true where user_id in($1,$2)",
    [stranger, pending]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [blocked, viewer]
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [banned]
  );
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [deleted]
  );
  const id = n => `79000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
  for (let i = 0; i < 25; i++)
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body,created_at) values($1,$2,$3,'2026-10-20T13:00:00Z')",
      [id(i), friend, `Friend ${i}`]
    );
  const mediaId = id(99);
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body,media_path,gif_url,created_at) values($1,$2,'Private image',$3,null,'2026-10-20T14:00:00Z')",
    [mediaId, reverse, `${reverse}/${id(98)}.png`]
  );
  const login = async (player, role = "authenticated") => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      player ?? ""
    ]);
  };
  const feed = async (cursor = null, limit = 10) =>
    (
      await db.query("select public.get_friend_wall_feed($1,$2,$3) value", [
        cursor?.at ?? null,
        cursor?.id ?? null,
        limit
      ])
    ).rows[0].value;
  await login(viewer, "anon");
  await assert.rejects(feed(), /permission denied/);
  await login(null);
  await assert.rejects(feed(), /AUTH_REQUIRED/);
  await login(viewer);
  await assert.rejects(
    feed({ at: "2026-10-20T12:00:00Z" }),
    /FEED_CURSOR_INVALID/
  );
  const first = await feed();
  assert.equal(first.items.length, 10);
  assert.equal(first.items[0].id, mediaId);
  assert.equal(first.items[0].hasMedia, true);
  assert.ok(!("mediaPath" in first.items[0]));
  assert.deepEqual(Object.keys(first.items[0].author).sort(), [
    "avatarUrl",
    "id",
    "name",
    "profileStyle"
  ]);
  const all = [...first.items];
  let cursor = first.next;
  while (cursor) {
    const page = await feed(cursor);
    all.push(...page.items);
    cursor = page.next;
  }
  assert.equal(all.length, 28);
  assert.equal(new Set(all.map(post => post.id)).size, 28);
  assert.ok(all.every(post => [friend, reverse].includes(post.author.id)));
  assert.deepEqual(
    all.filter(post => post.text.startsWith("Friend ")).map(post => post.id),
    Array.from({ length: 25 }, (_, i) => id(24 - i))
  );
  assert.equal((await feed(null, 1000)).items.length, 20);
  assert.equal((await feed(null, -1)).items.length, 1);
  await db.exec("reset role");
  await db.query("delete from public.friendships where friend_id=$1", [friend]);
  await login(viewer);
  assert.ok((await feed()).items.every(post => post.author.id === reverse));
  await db.exec("reset role");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [viewer, reverse]
  );
  await login(viewer);
  assert.deepEqual(await feed(), { items: [], next: null });
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
  const grants = (
    await db.query(
      "select has_function_privilege('anon','public.get_friend_wall_feed(timestamptz,uuid,integer)','execute') anon, has_function_privilege('service_role','public.get_friend_wall_feed(timestamptz,uuid,integer)','execute') service"
    )
  ).rows[0];
  assert.deepEqual(grants, { anon: false, service: false });
});
