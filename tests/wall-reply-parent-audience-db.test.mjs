import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("private B replies on public A's post: A/C read and moderate, B sees a truthful audience notice", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column banned_until timestamptz; alter table storage.objects add column id uuid default gen_random_uuid(); alter table storage.objects add column metadata jsonb; grant select,delete on storage.objects to authenticated"
  );
  const id = n => `95200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [a, b, c] = [1, 2, 3].map(id),
    post = id(10),
    reply = id(11),
    image = `${b}/${id(12)}.png`;
  for (const [i, user] of [a, b, c].entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `ReplyAudience${i}` })]
    );
    await db.query(
      "update public.user_profiles set is_public=$2 where user_id=$1",
      [user, user === a]
    );
  }
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'Public post')",
    [post, a]
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id,metadata) values('profile-wall-media',$1,$2,$3::jsonb)",
    [image, b, JSON.stringify({ size: 8, mimetype: "image/png" })]
  );
  const root = () =>
    db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");
  const login = async user => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const call = async (name, args = []) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, n) => "$" + (n + 1)).join(",")}) value`,
        args
      )
    ).rows[0].value;
  await login(b);
  const published = await call("publish_wall_post_reply_media", [
    post,
    reply,
    "Private profile, public reply",
    image,
    null
  ]);
  assert.equal(published.publicReplyNotice, true);
  await call("publish_wall_post_reply_media", [
    post,
    reply,
    "Private profile, public reply",
    image,
    null
  ]);
  assert.ok(published.items.some(r => r.id === reply && r.isMe));
  for (const user of [a, c, b]) {
    await login(user);
    const result = await call("get_wall_post_activity", [post]);
    assert.equal(result.replyCount, 1);
    assert.ok(
      result.items.some(r => r.id === reply),
      "reply inherits the parent audience"
    );
    assert.equal(result.items[0].canDelete, user === a || user === b);
    assert.deepEqual(
      (await call("get_wall_posts_activity", [[post]]))[post],
      result
    );
    assert.equal(await call("get_wall_reply_media", [reply]), image);
    assert.equal(
      (
        await db.query("select name from storage.objects where name=$1", [
          image
        ])
      ).rows.length,
      1
    );
    if (user !== b) {
      assert.equal(
        await call("can_read_profile_wall", [b]),
        false,
        "B wall stays private"
      );
      await assert.rejects(call("get_profile_wall", [b]), /WALL_PRIVATE/);
    }
  }
  await login(a);
  let notifications = (await call("list_notifications", [50])).filter(
    n => n.type === "wall_post_reply" && n.referenceId === post
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].actorPseudo, "ReplyAudience1");
  await call("mark_notification_read", [notifications[0].id]);
  const readAt = (await call("list_notifications", [50])).find(
    n => n.id === notifications[0].id
  ).readAt;
  await login(b);
  await call("publish_wall_post_reply_media", [
    post,
    reply,
    "Private profile, public reply",
    image,
    null
  ]);
  await login(a);
  assert.equal(
    (await call("list_notifications", [50])).find(
      n => n.id === notifications[0].id
    ).readAt,
    readAt
  );
  await call("report_user", [b, "spam", "wall_reply", reply]);
  await login(c);
  await call("report_user", [b, "spam", "wall_reply", reply]);
  // Profile privacy never hides this contribution; account and block guards do.
  for (const [x, y] of [
    [a, b],
    [b, a],
    [c, b],
    [b, c]
  ]) {
    await root();
    await db.query(
      "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
      [x, y]
    );
    const reader = x === b ? y : x;
    await login(reader);
    assert.equal((await call("get_wall_post_activity", [post])).replyCount, 0);
    assert.ok(
      (await call("get_wall_post_activity", [post])).items.every(
        r => r.id !== reply
      )
    );
    assert.deepEqual(
      (await call("get_wall_posts_activity", [[post]]))[post],
      await call("get_wall_post_activity", [post])
    );
    await assert.rejects(
      call("get_wall_reply_media", [reply]),
      /WALL_POST_UNAVAILABLE/
    );
    assert.equal(
      (
        await db.query("select name from storage.objects where name=$1", [
          image
        ])
      ).rows.length,
      0
    );
    await assert.rejects(
      call("report_user", [b, "spam", "wall_reply", reply]),
      /REPORT_INVALID/
    );
    if (reader === a)
      assert.equal(
        (await call("list_notifications", [50])).filter(
          n => n.type === "wall_post_reply" && n.referenceId === post
        ).length,
        0
      );
    await root();
    await db.exec("delete from public.user_blocks");
  }
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    b
  ]);
  await login(a);
  assert.equal((await call("get_wall_post_activity", [post])).replyCount, 0);
  assert.equal(
    (await call("list_notifications", [50])).filter(
      n => n.type === "wall_post_reply" && n.referenceId === post
    ).length,
    0
  );
  await assert.rejects(
    call("get_wall_reply_media", [reply]),
    /WALL_POST_UNAVAILABLE/
  );
  await root();
  await db.query("update auth.users set banned_until=null where id=$1", [b]);
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [a]
  );
  await login(c);
  await assert.rejects(
    call("get_wall_post_activity", [post]),
    /WALL_POST_UNAVAILABLE/
  );
  await assert.rejects(
    call("get_wall_reply_media", [reply]),
    /WALL_POST_UNAVAILABLE/
  );
  await root();
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [a]
  );
  await login(a);
  const removed = await call("delete_wall_post_reply", [post, reply]);
  assert.equal(removed.replyCount, 0);
  assert.equal(removed.deletedMediaPath, image);
  assert.equal(
    await call("authorize_wall_reply_media_cleanup", [image]),
    image
  );
  // A new contribution disappears immediately when its author enters deletion.
  await root();
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body) values($1,$2,$3,'To be removed')",
    [id(20), post, b]
  );
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [b]
  );
  await login(c);
  assert.equal((await call("get_wall_post_activity", [post])).replyCount, 0);
});
