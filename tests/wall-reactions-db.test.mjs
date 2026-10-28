import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("emoji reactions are persistent, idempotent, bounded and filtered by the live wall ACL", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column banned_until timestamptz; create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const [viewer, friend, stranger] = [1, 2, 3].map(
    n => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  const post = "99100000-0000-4000-8000-000000000001";
  for (const [i, id] of [viewer, friend, stranger].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `Reaction${i}` })]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [viewer, friend]
  );
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'A great pull')",
    [post, friend]
  );
  const login = async (id, role = "authenticated") => {
    await db.exec(`reset role;set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? ""
    ]);
  };
  const react = async (emoji = "fire", state = true) =>
    (
      await db.query("select public.set_wall_post_reaction($1,$2,$3) value", [
        post,
        emoji,
        state
      ])
    ).rows[0].value;
  const read = async () =>
    (await db.query("select public.get_wall_post_activity($1) value", [post]))
      .rows[0].value;
  await login(viewer, "anon");
  await assert.rejects(react(), /permission denied/);
  await login(null);
  await assert.rejects(react(), /AUTH_REQUIRED/);
  await login(stranger);
  assert.equal((await react()).reactions[0].reactedByMe, true);
  await react("fire", false);
  await login(viewer);
  await assert.rejects(
    db.exec("select * from public.wall_post_reactions"),
    /permission denied/
  );
  await assert.rejects(react("<script>"), /WALL_REACTION_INVALID/);
  await assert.rejects(react(null), /WALL_REACTION_INVALID/);
  await assert.rejects(react("fire", null), /WALL_REACTION_INVALID/);
  assert.deepEqual((await react()).reactions, [
    { emoji: "fire", count: 1, reactedByMe: true }
  ]);
  assert.equal((await react()).reactions[0].count, 1, "idempotent retry");
  assert.deepEqual(
    (await read()).reactions,
    (await react()).reactions,
    "persistent read"
  );
  const like = (
    await db.query("select public.set_wall_post_like($1,true) value", [post])
  ).rows[0].value;
  assert.equal(
    like.reactions[0].emoji,
    "fire",
    "legacy mutation returns enriched activity"
  );
  await login(friend);
  assert.equal((await react()).reactions[0].count, 2);
  await login(viewer);
  assert.equal((await react("fire", false)).reactions[0].count, 1);
  assert.equal((await read()).reactions[0].reactedByMe, false);
  for (const emoji of [
    "heart",
    "laugh",
    "eyes",
    "sparkles",
    "hundred",
    "party",
    "smile",
    "wow"
  ])
    await react(emoji);
  await assert.rejects(react("diamond"), /WALL_REACTION_LIMIT/);
  await react("heart"); // Existing selection still idempotent at the limit.
  await react("heart", false);
  await react("diamond");
  await db.exec("reset role");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [friend, viewer]
  );
  await login(viewer);
  await assert.rejects(read(), /WALL_POST_UNAVAILABLE/);
  await assert.rejects(react(), /WALL_POST_UNAVAILABLE/);
  await login(friend);
  assert.equal(
    (await read()).reactions.length,
    1,
    "blocked contributor hidden"
  );
  await db.exec("reset role;delete from public.user_blocks");
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [viewer]
  );
  await login(viewer);
  await assert.rejects(react(), /ACCOUNT_BANNED/);
  await login(friend);
  assert.equal((await read()).reactions.length, 1, "banned contributor hidden");
  await db.exec("reset role");
  await db.query("update auth.users set banned_until=null where id=$1", [
    viewer
  ]);
  await db.exec("set role service_role");
  await db.query("select public.reserve_data_export($1,$2)", [viewer, post]);
  const data = (
    await db.query("select public.build_data_export($1,$2) value", [
      viewer,
      post
    ])
  ).rows[0].value;
  assert.equal(data.wall_post_reactions.length, 8);
  assert.ok(data.wall_post_reactions.every(item => item.emoji !== "fire"));
  await assert.rejects(
    db.query("select public.get_wall_post_activity_without_reactions($1)", [
      post
    ]),
    /permission denied/
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("delete from public.friendships where user_id=$1", [viewer]);
  await login(viewer);
  assert.ok(
    (await react(data.wall_post_reactions[0].emoji, false)).reactions.every(
      item =>
        item.emoji !== data.wall_post_reactions[0].emoji || !item.reactedByMe
    )
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [viewer]
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.wall_post_reactions where user_id=$1",
        [viewer]
      )
    ).rows[0].n,
    0
  );
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("delete from public.profile_wall_posts where id=$1", [post]);
  assert.equal(
    (await db.query("select count(*)::int n from public.wall_post_reactions"))
      .rows[0].n,
    0
  );
});
