import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("wall likes and replies persist with dynamic privacy, idempotence, quotas, ownership and deletion cleanup", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column banned_until timestamptz");
  const ids = Array.from(
    { length: 5 },
    (_, i) => `89000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  const [viewer, friend, stranger, other, banned] = ids;
  for (const [i, id] of ids.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `Interaction${i}` })]
    );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=any($1::uuid[])",
    [ids]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted'),($1,$3,'accepted'),($2,$3,'accepted'),($1,$4,'accepted')",
    [viewer, friend, other, banned]
  );
  const post = "89100000-0000-4000-8000-000000000001",
    reply = "89200000-0000-4000-8000-000000000001";
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'Original post')",
    [post, friend]
  );
  const login = async (id, role = "authenticated") => {
    await db.exec(`reset role;set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? ""
    ]);
  };
  const activity = async () =>
    (await db.query("select public.get_wall_post_activity($1) value", [post]))
      .rows[0].value;
  const like = async state =>
    (
      await db.query("select public.set_wall_post_like($1,$2) value", [
        post,
        state
      ])
    ).rows[0].value;
  const publish = async (id = reply, text = "Great pull!") =>
    (
      await db.query("select public.publish_wall_post_reply($1,$2,$3) value", [
        post,
        id,
        text
      ])
    ).rows[0].value;
  await login(viewer, "anon");
  await assert.rejects(activity(), /permission denied/);
  await login(null);
  await assert.rejects(activity(), /AUTH_REQUIRED/);
  await login(stranger);
  await assert.rejects(like(true), /WALL_POST_UNAVAILABLE/);
  await assert.rejects(publish(), /WALL_POST_UNAVAILABLE/);
  await login(viewer);
  for (const table of ["wall_post_likes", "wall_post_replies"])
    await assert.rejects(
      db.exec(`select * from public.${table}`),
      /permission denied/
    );
  assert.equal((await like(true)).likes, 1);
  assert.equal((await like(true)).likes, 1);
  assert.equal((await like(false)).likes, 0);
  assert.equal((await like(false)).likedByMe, false);
  const first = await publish();
  assert.equal(first.replyCount, 1);
  assert.equal(first.items[0].isMe, true);
  assert.equal(
    (await publish()).replyCount,
    1,
    "retry same id must not duplicate"
  );
  await assert.rejects(publish(reply, "Changed"), /WALL_REPLY_INVALID/);
  await assert.rejects(publish(ids[4], "x".repeat(1001)), /WALL_REPLY_INVALID/);
  await assert.rejects(publish(ids[4], "  "), /WALL_REPLY_INVALID/);
  await assert.rejects(publish(ids[4]), /WALL_REPLY_RATE_LIMITED/);
  await login(other);
  await db.query("select public.delete_wall_post_reply($1,$2)", [post, reply]);
  assert.equal(
    (await activity()).replyCount,
    1,
    "cannot remove someone else's reply"
  );
  await assert.rejects(publish(reply), /WALL_REPLY_INVALID/);
  await login(viewer);
  await like(true);
  await db.exec("reset role");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [friend, viewer]
  );
  await login(viewer);
  await assert.rejects(activity(), /WALL_POST_UNAVAILABLE/);
  await assert.rejects(like(false), /WALL_POST_UNAVAILABLE/);
  await login(other);
  assert.equal((await activity()).replyCount, 1);
  await db.exec("reset role");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [other, viewer]
  );
  await login(other);
  assert.equal((await activity()).replyCount, 0, "blocked reply author hidden");
  assert.equal((await activity()).likes, 0);
  await db.exec("reset role;delete from public.user_blocks");
  await db.query(
    "delete from public.friendships where user_id=$1 and friend_id=$2",
    [viewer, friend]
  );
  await login(viewer);
  await assert.rejects(activity(), /WALL_POST_UNAVAILABLE/);
  await db.exec("reset role");
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [viewer, friend]
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [viewer]
  );
  await login(viewer);
  await assert.rejects(publish(), /ACCOUNT_BANNED/);
  await login(other);
  assert.equal((await activity()).replyCount, 0, "banned reply author hidden");
  await db.exec("reset role");
  await db.query("update auth.users set banned_until=null where id=$1", [
    viewer
  ]);
  // Many same-timestamp replies: stable page boundary, no overlap.
  for (let i = 0; i < 25; i++)
    await db.query(
      "insert into public.wall_post_replies(id,post_id,user_id,body,created_at) values($1,$2,$3,'Older reply','2026-01-01')",
      [`89300000-0000-4000-8000-${String(i).padStart(12, "0")}`, post, other]
    );
  await login(viewer);
  const seen = new Set();
  let cursor = null;
  do {
    const page = (
      await db.query("select public.get_wall_post_activity($1,$2,$3) value", [
        post,
        cursor?.at ?? null,
        cursor?.id ?? null
      ])
    ).rows[0].value;
    assert.ok(page.items.length <= 10);
    for (const item of page.items) {
      assert.ok(!seen.has(item.id));
      seen.add(item.id);
    }
    cursor = page.next;
  } while (cursor);
  assert.equal(seen.size, 26);
  await assert.rejects(
    db.query("select public.get_wall_post_activity($1,now(),null)", [post]),
    /WALL_CURSOR_INVALID/
  );
  // Export only this player's contributions, not other reply text or author IDs.
  await db.exec(
    "reset role; create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  await db.exec("set role service_role");
  await db.query("select public.reserve_data_export($1,$2)", [viewer, reply]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      viewer,
      reply
    ])
  ).rows[0].value;
  assert.equal(exported.wall_post_replies.length, 1);
  assert.equal(exported.wall_post_replies[0].text, "Great pull!");
  assert.equal(exported.wall_post_likes.length, 1);
  assert.ok(!JSON.stringify(exported.wall_post_replies).includes(other));
  await assert.rejects(
    db.query(
      "select public.build_data_export_without_wall_interactions($1,$2)",
      [viewer, reply]
    ),
    /permission denied/
  );
  await login(viewer);
  await db.query("select public.delete_wall_post_reply($1,$2)", [post, reply]);
  assert.equal((await activity()).replyCount, 25);
  await db.exec("reset role");
  // Exercise the hourly ceiling independently of the five-second cooldown.
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,created_at) select ('89400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$2,'Hourly fixture',now()-interval '10 minutes' from generate_series(1,30) n",
    [post, viewer]
  );
  await login(viewer);
  await assert.rejects(publish(ids[4]), /WALL_REPLY_RATE_LIMITED/);
  await db.exec("reset role");
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,created_at) select ('89500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$2,'Capacity fixture','2026-01-01' from generate_series(1,445) n",
    [post, other]
  );
  await login(friend);
  await assert.rejects(publish(ids[4]), /WALL_REPLIES_FULL/);
  await db.exec("reset role");
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [viewer]
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.wall_post_likes where user_id=$1",
        [viewer]
      )
    ).rows[0].n,
    0
  );
  await login(viewer);
  await assert.rejects(activity(), /AUTH_REQUIRED/);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("delete from public.profile_wall_posts where id=$1", [post]);
  assert.equal(
    (await db.query("select count(*)::int n from public.wall_post_replies"))
      .rows[0].n,
    0
  );
});
