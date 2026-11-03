import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
test("nested replies preserve their parent, audience, pagination and targeted idempotent notifications", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const id = n => `af110000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [owner, alice, bob, stranger] = [1, 2, 3, 4].map(id),
    post = id(10),
    other = id(11),
    parent = id(20),
    child = id(21);
  for (const [i, user] of [owner, alice, bob, stranger].entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `Thread${i}` })]
    );
    await db.query(
      "update public.user_profiles set is_public=$2 where user_id=$1",
      [user, user === owner]
    );
  }
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body) values($1,$3,'Post'),($2,$3,'Other')",
    [post, other, owner]
  );
  const root = async () =>
    db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");
  const as = async (user, name, args = []) => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    try {
      return (
        await db.query(
          `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
          args
        )
      ).rows[0].result;
    } finally {
      await root();
    }
  };
  const cool = () =>
    db.exec(
      "update public.wall_post_replies set created_at=clock_timestamp()-interval '20 seconds'"
    );
  await as(alice, "publish_wall_post_reply", [post, parent, "Parent"]);
  await cool();
  let result = await as(bob, "publish_wall_post_reply_to", [
    post,
    child,
    parent,
    "Child"
  ]);
  assert.equal(result.items.find(r => r.id === child).parentId, parent);
  const notes = await as(alice, "list_notifications");
  const note = notes.find(n => n.type === "wall_reply_received");
  assert(note);
  assert.equal(note.actorPseudo, "Thread2");
  assert.equal(note.postId, post);
  assert.equal(note.postOwnerId, owner);
  assert.equal(note.replyId, child);
  assert(!JSON.stringify(note).includes("Child"));
  assert.equal(
    (await as(owner, "list_notifications")).filter(
      n => n.type === "wall_reply_received"
    ).length,
    0
  );
  assert.equal((await as(stranger, "list_notifications")).length, 0);
  await as(alice, "mark_notification_read", [note.id]);
  const read = (await as(alice, "list_notifications")).find(
    n => n.id === note.id
  ).readAt;
  await as(bob, "publish_wall_post_reply_to", [post, child, parent, "Child"]);
  assert.equal(
    (await as(alice, "list_notifications")).find(n => n.id === note.id).readAt,
    read
  );
  await assert.rejects(
    as(bob, "publish_wall_post_reply_to", [post, child, id(999), "Child"]),
    /WALL_REPLY_INVALID/
  );
  await cool();
  await assert.rejects(
    as(bob, "publish_wall_post_reply_to", [
      other,
      id(30),
      parent,
      "Wrong post"
    ]),
    /WALL_REPLY_UNAVAILABLE/
  );
  await assert.rejects(
    as(bob, "publish_wall_post_reply_to", [post, id(31), id(999), "Missing"]),
    /WALL_REPLY_UNAVAILABLE/
  );
  await assert.rejects(
    as(bob, "publish_wall_post_reply_to", [
      post,
      id(32),
      parent,
      "",
      "not-owned.png",
      null
    ]),
    /WALL_MEDIA_INVALID/
  );
  await assert.rejects(
    as(bob, "publish_wall_post_reply_to", [
      post,
      id(33),
      parent,
      "",
      "",
      "https://evil.example/image.gif"
    ]),
    /WALL_REPLY_INVALID/
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id)values($1,$2)",
    [alice, bob]
  );
  assert.equal(
    (await as(alice, "list_notifications")).filter(
      n => n.type === "wall_reply_received"
    ).length,
    0
  );
  await assert.rejects(
    as(bob, "publish_wall_post_reply_to", [post, id(34), parent, "Blocked"]),
    /WALL_REPLY_UNAVAILABLE/
  );
  await db.exec("delete from public.user_blocks");
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    bob
  ]);
  assert.equal(
    (await as(alice, "list_notifications")).filter(
      n => n.type === "wall_reply_received"
    ).length,
    0
  );
  await assert.rejects(
    as(bob, "publish_wall_post_reply_to", [post, id(35), parent, "Banned"]),
    /ACCOUNT_BANNED/
  );
  await db.query("update auth.users set banned_until=null where id=$1", [bob]);
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  assert.equal(
    (await as(alice, "list_notifications")).filter(
      n => n.type === "wall_reply_received"
    ).length,
    0
  );
  await assert.rejects(
    as(bob, "get_wall_post_activity", [post]),
    /WALL_POST_UNAVAILABLE/
  );
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [owner]
  );
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  await db.query("select public.reserve_data_export($1,$2)", [bob, id(900)]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      bob,
      id(900)
    ])
  ).rows[0].value;
  assert.equal(
    exported.wall_post_replies.find(r => r.id === child).parent_reply_id,
    parent
  );
  // Push uses exactly the same live access fence.
  const push = await db.query(
    "select public.get_push_notification($1,$2) result",
    [note.id, note.createdAt]
  );
  assert.equal(push.rows[0].result.notification.replyId, child);
  await db.query(
    "update public.wall_post_replies set created_at=clock_timestamp()-interval '1 hour' where id=$1",
    [parent]
  );
  for (let i = 0; i < 11; i++)
    await db.query(
      "insert into public.wall_post_replies(id,post_id,user_id,body,created_at)values($1,$2,$3,'Other reply',clock_timestamp()-interval '10 minutes'+$4*interval '1 second')",
      [id(100 + i), post, owner, i]
    );
  result = await as(alice, "get_wall_post_activity", [post]);
  assert.equal(result.items.length, 10);
  assert(result.threadContext.some(r => r.id === parent));
  assert(result.next);
  const page2 = await as(alice, "get_wall_post_activity", [
    post,
    result.next.at,
    result.next.id
  ]);
  assert(!result.items.some(a => page2.items.some(b => a.id === b.id)));
  await cool();
  await as(alice, "publish_wall_post_reply_to", [post, id(36), parent, "Self"]);
  assert.equal(
    (await as(alice, "list_notifications")).filter(
      n => n.type === "wall_reply_received"
    ).length,
    1
  );
  await as(bob, "delete_wall_post_reply", [post, child]);
  assert.equal(
    (await as(alice, "list_notifications")).filter(
      n => n.type === "wall_reply_received"
    ).length,
    0
  );
  await as(alice, "delete_wall_post_reply", [post, parent]);
  result = await as(owner, "get_wall_post_activity", [post]);
  assert.equal(result.items.find(r => r.id === id(36)).parentId, null);
  for (const role of ["anon", "service_role"]) {
    await db.exec("set role " + role);
    await assert.rejects(
      db.query("select public.publish_wall_post_reply_to($1,$2,$3,$4)", [
        post,
        id(40),
        parent,
        "Denied"
      ]),
      /permission denied/
    );
    await root();
  }
});
