import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("option C: a stranger can read and interact with a public wall", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const owner = "95000000-0000-4000-8000-000000000001",
    viewer = "95000000-0000-4000-8000-000000000002",
    post = "95000000-0000-4000-8000-000000000010";
  for (const [n, id] of [owner, viewer].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `PublicInteraction${n}` })]
    );
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [owner]
  );
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'Public story')",
    [post, owner]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  const activity = (
    await db.query("select public.get_wall_post_activity($1) value", [post])
  ).rows[0].value;
  assert.equal(activity.publicReplyNotice, true);
  assert.equal(
    (await db.query("select public.set_wall_post_like($1,true) value", [post]))
      .rows[0].value.likedByMe,
    true
  );
});

test("option C matrix, live privacy, moderation, quotas, notifications and storage receipts", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column banned_until timestamptz; alter table storage.objects add column id uuid default gen_random_uuid(); alter table storage.objects add column metadata jsonb; grant select,insert,delete on storage.objects to authenticated"
  );
  const id = n => `95100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [owner, friend, stranger, privateOwner, blocked, replyAuthor] = [
    1, 2, 3, 4, 5, 6
  ].map(id);
  for (const [n, user] of [
    owner,
    friend,
    stranger,
    privateOwner,
    blocked,
    replyAuthor
  ].entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `OptionC${n}` })]
    );
    await db.query(
      "update public.user_profiles set is_public=$2 where user_id=$1",
      [user, user !== privateOwner]
    );
  }
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted'),($3,$2,'accepted')",
    [owner, friend, privateOwner]
  );
  const post = id(10),
    privatePost = id(11),
    reply = id(12),
    privateReply = id(13);
  for (const [key, user] of [
    [post, owner],
    [privatePost, privateOwner]
  ])
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'Story')",
      [key, user]
    );
  for (const [key, parent] of [
    [reply, post],
    [privateReply, privatePost]
  ])
    await db.query(
      "insert into public.wall_post_replies(id,post_id,user_id,body) values($1,$2,$3,'Initial reply')",
      [key, parent, replyAuthor]
    );
  const root = () =>
    db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");
  const login = async user => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const rpc = async (name, args) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
        args
      )
    ).rows[0].value;
  const activity = key => rpc("get_wall_post_activity", [key]);
  const grouped = keys => rpc("get_wall_posts_activity", [keys]);
  let sequence = 100;
  for (const [label, user, parent, author, allowed, direction] of [
    ["owner", owner, post, owner, true, null],
    ["friend public", friend, post, owner, true, null],
    ["stranger public", stranger, post, owner, true, null],
    ["owner private", privateOwner, privatePost, privateOwner, true, null],
    ["friend private", friend, privatePost, privateOwner, true, null],
    ["stranger private", stranger, privatePost, privateOwner, false, null],
    ["blocked outgoing", blocked, post, owner, false, 0],
    ["blocked incoming", blocked, post, owner, false, 1]
  ]) {
    if (direction !== null) {
      await root();
      await db.query(
        "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
        direction === 0 ? [user, author] : [author, user]
      );
    }
    await login(user);
    const read = () => rpc("get_profile_wall", [author]);
    const like = () => rpc("set_wall_post_like", [parent, true]);
    const react = () => rpc("set_wall_post_reaction", [parent, "heart", true]);
    const publish = () =>
      rpc("publish_wall_post_reply", [parent, id(sequence++), "A new reply"]);
    const reportPost = () =>
      rpc("report_user", [author, "spam", "wall_post", parent]);
    const reportReply = () =>
      rpc("report_user", [
        replyAuthor,
        "spam",
        "wall_reply",
        parent === post ? reply : privateReply
      ]);
    if (allowed) {
      assert.ok(
        (await read()).items.some(p => p.id === parent),
        label
      );
      const first = await activity(parent);
      assert.ok(
        first.items.some(
          r => r.id === (parent === post ? reply : privateReply)
        ),
        label
      );
      assert.deepEqual(
        (await grouped([parent, id(999)]))[parent],
        first,
        label
      );
      assert.equal(first.publicReplyNotice, label === "stranger public", label);
      assert.equal((await like()).likedByMe, true, label);
      assert.equal(
        (await rpc("set_wall_post_like", [parent, false])).likedByMe,
        false,
        label
      );
      assert.ok(
        (await react()).reactions.some(
          r => r.emoji === "heart" && r.reactedByMe
        ),
        label
      );
      assert.ok(
        (
          await rpc("set_wall_post_reaction", [parent, "heart", false])
        ).reactions.every(r => !r.reactedByMe),
        label
      );
      await root();
      await db.query(
        "update public.wall_post_replies set created_at=now()-interval '1 minute' where user_id=$1",
        [user]
      );
      await login(user);
      const published = await publish();
      assert.ok(
        published.items.some(r => r.isMe),
        label
      );
      if (user === author)
        await assert.rejects(reportPost(), /REPORT_INVALID/, label);
      else await reportPost();
      await reportReply();
      const moderated = id(sequence++);
      await root();
      await db.query(
        "insert into public.wall_post_replies(id,post_id,user_id,body) values($1,$2,$3,'Moderation check')",
        [moderated, parent, replyAuthor]
      );
      await login(user);
      const afterDelete = await rpc("delete_wall_post_reply", [
        parent,
        moderated
      ]);
      assert.equal(
        afterDelete.items.some(r => r.id === moderated),
        user !== author,
        label + " owner moderation"
      );
      await root();
      await db.query("delete from public.wall_post_replies where id=$1", [
        moderated
      ]);
      await login(user);
    } else {
      await assert.rejects(read(), /WALL_PRIVATE/, label);
      for (const action of [
        () => activity(parent),
        like,
        react,
        publish,
        () => rpc("delete_wall_post_reply", [parent, reply])
      ])
        await assert.rejects(action(), /WALL_POST_UNAVAILABLE/, label);
      assert.deepEqual(await grouped([parent]), {}, label);
      await assert.rejects(reportPost(), /REPORT_INVALID/, label);
      await assert.rejects(reportReply(), /REPORT_INVALID/, label);
    }
    await root();
    await db.exec("delete from public.user_blocks");
  }
  // Public -> private revokes every stranger action immediately, including media.
  const image = `${replyAuthor}/${id(300)}.png`,
    mediaReply = id(301);
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id,metadata) values('profile-wall-media',$1,$2,$3)",
    [image, replyAuthor, JSON.stringify({ size: 10, mimetype: "image/png" })]
  );
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,media_path) values($1,$2,$3,'Image',$4)",
    [mediaReply, post, replyAuthor, image]
  );
  await login(stranger);
  assert.equal(await rpc("get_wall_reply_media", [mediaReply]), image);
  assert.equal(
    (await db.query("select name from storage.objects where name=$1", [image]))
      .rows.length,
    1
  );
  await root();
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  await login(stranger);
  for (const [name, args] of [
    ["get_wall_post_activity", [post]],
    ["set_wall_post_like", [post, true]],
    ["set_wall_post_reaction", [post, "fire", true]],
    ["publish_wall_post_reply", [post, id(302), "No"]],
    ["get_wall_reply_media", [mediaReply]]
  ])
    await assert.rejects(rpc(name, args), /WALL_POST_UNAVAILABLE/);
  await assert.rejects(rpc("get_profile_wall", [owner]), /WALL_PRIVATE/);
  assert.deepEqual(await grouped([post]), {});
  assert.equal(
    (await db.query("select name from storage.objects where name=$1", [image]))
      .rows.length,
    0
  );
  await assert.rejects(
    rpc("report_user", [owner, "spam", "wall_post", post]),
    /REPORT_INVALID/
  );
  await assert.rejects(
    rpc("report_user", [replyAuthor, "spam", "wall_reply", mediaReply]),
    /REPORT_INVALID/
  );
  await root();
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [owner]
  );
  // Banned/deleting authors and viewers lose access; blocked reply actors stay hidden.
  for (const user of [owner, stranger]) {
    await db.query(
      "update auth.users set banned_until='infinity' where id=$1",
      [user]
    );
    await login(stranger);
    await assert.rejects(
      activity(post),
      user === stranger ? /AUTH_REQUIRED/ : /WALL_POST_UNAVAILABLE/
    );
    await assert.rejects(rpc("get_profile_wall", [owner]), /WALL_PRIVATE/);
    if (user === stranger)
      await assert.rejects(grouped([post]), /AUTH_REQUIRED/);
    else assert.deepEqual(await grouped([post]), {});
    for (const [name, args] of [
      ["set_wall_post_like", [post, true]],
      ["set_wall_post_reaction", [post, "heart", true]],
      ["publish_wall_post_reply", [post, id(sequence++), "Banned"]]
    ])
      await assert.rejects(
        rpc(name, args),
        user === stranger ? /ACCOUNT_BANNED/ : /WALL_POST_UNAVAILABLE/
      );
    await assert.rejects(
      rpc("report_user", [owner, "spam", "wall_post", post]),
      user === stranger ? /ACCOUNT_BANNED/ : /REPORT_INVALID/
    );
    await assert.rejects(
      rpc("report_user", [replyAuthor, "spam", "wall_reply", reply]),
      user === stranger ? /ACCOUNT_BANNED/ : /REPORT_INVALID/
    );
    await root();
    await db.query("update auth.users set banned_until=null where id=$1", [
      user
    ]);
  }
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    replyAuthor
  ]);
  await login(stranger);
  assert.ok(
    (await activity(post)).items.every(r => r.author.id !== replyAuthor)
  );
  await root();
  await db.query("update auth.users set banned_until=null where id=$1", [
    replyAuthor
  ]);
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [replyAuthor, stranger]
  );
  await login(stranger);
  assert.ok(
    (await activity(post)).items.every(r => r.author.id !== replyAuthor)
  );
  await root();
  await db.exec("delete from public.user_blocks");
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [replyAuthor]
  );
  await login(stranger);
  assert.ok(
    (await activity(post)).items.some(r => r.author.id === replyAuthor),
    "reply author privacy does not override the parent audience"
  );
  await root();
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [replyAuthor]
  );
  // Owner moderation grants deletion of only the exact unbound storage object.
  await login(friend);
  await rpc("delete_wall_post_reply", [post, mediaReply]);
  assert.ok((await activity(post)).items.some(r => r.id === mediaReply));
  await login(owner);
  assert.ok(
    (await activity(post)).items.find(r => r.id === mediaReply).canDelete
  );
  const removed = await rpc("delete_wall_post_reply", [post, mediaReply]);
  assert.equal(removed.deletedMediaPath, image);
  assert.ok(!removed.items.some(r => r.id === mediaReply));
  assert.equal(
    (await db.query("select name from storage.objects where name=$1", [image]))
      .rows.length,
    0,
    "moderation receipt grants no storage read"
  );
  assert.equal(
    (
      await db.query(
        "delete from storage.objects where name=$1 returning name",
        [image]
      )
    ).rows.length,
    0,
    "moderation receipt grants no browser deletion"
  );
  await assert.rejects(
    db.exec("select * from public.wall_reply_media_cleanup"),
    /permission denied/
  );
  await login(friend);
  assert.equal(
    (
      await db.query(
        "delete from storage.objects where name=$1 returning name",
        [image]
      )
    ).rows.length,
    0
  );
  await assert.rejects(
    rpc("authorize_wall_reply_media_cleanup", [image]),
    /WALL_MEDIA_INVALID/
  );
  await root();
  // Inject historical corruption past the new publication fence; retain the
  // independent exact-object authorization assertion below.
  await db.exec(
    "alter table public.wall_post_replies disable trigger wall_reply_cleanup_guard"
  );
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,media_path) values($1,$2,$3,'Rebound',$4)",
    [id(320), post, replyAuthor, image]
  );
  await db.exec(
    "alter table public.wall_post_replies enable trigger wall_reply_cleanup_guard"
  );
  await login(owner);
  await assert.rejects(
    rpc("authorize_wall_reply_media_cleanup", [image]),
    /WALL_MEDIA_INVALID/,
    "bound files cannot be cleaned"
  );
  await root();
  await db.query("delete from public.wall_post_replies where id=$1", [id(320)]);
  await login(owner);
  assert.equal(await rpc("authorize_wall_reply_media_cleanup", [image]), image);
  await root();
  await db.query("delete from storage.objects where name=$1", [image]);
  await root();
  // Fault-inject an object replacement to keep the exact-id defense checked
  // independently of the new single-use path upload fence.
  await db.exec(
    "alter table storage.objects disable trigger wall_storage_cleanup_guard"
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id,metadata) values('profile-wall-media',$1,$2,$3)",
    [image, replyAuthor, JSON.stringify({ size: 10, mimetype: "image/png" })]
  );
  await db.exec(
    "alter table storage.objects enable trigger wall_storage_cleanup_guard"
  );
  await login(owner);
  await assert.rejects(
    rpc("authorize_wall_reply_media_cleanup", [image]),
    /WALL_MEDIA_INVALID/,
    "receipt cannot delete a recreated object"
  );
  // Reply rate limit is global per author; retries do not duplicate replies/notifications.
  await root();
  await db.query(
    "update public.wall_post_replies set created_at=now()-interval '1 minute' where user_id=$1",
    [stranger]
  );
  await login(stranger);
  const retryId = id(400);
  await rpc("publish_wall_post_reply", [post, retryId, "Notification"]);
  await rpc("publish_wall_post_reply", [post, retryId, "Notification"]);
  await assert.rejects(
    rpc("publish_wall_post_reply", [post, id(401), "Too fast"]),
    /WALL_REPLY_RATE_LIMITED/
  );
  await root();
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,created_at) select gen_random_uuid(),$1,$2,'Quota',now()-interval '1 minute' from generate_series(1,30)",
    [post, stranger]
  );
  await login(stranger);
  await assert.rejects(
    rpc("publish_wall_post_reply", [post, id(402), "Too many"]),
    /WALL_REPLY_RATE_LIMITED/
  );
  await login(owner);
  assert.equal(
    (await rpc("list_notifications", [50])).filter(
      n => n.type === "wall_post_reply" && n.referenceId === post
    ).length,
    1
  );
  await root();
  const notificationsBefore = (
    await db.query("select count(*)::int n from public.notifications")
  ).rows[0].n;
  await login(stranger);
  await rpc("set_wall_post_like", [post, true]);
  await rpc("set_wall_post_like", [post, true]);
  await rpc("set_wall_post_reaction", [post, "fire", true]);
  await rpc("set_wall_post_reaction", [post, "fire", true]);
  await root();
  assert.equal(
    (await db.query("select count(*)::int n from public.notifications")).rows[0]
      .n,
    notificationsBefore
  );
  for (const [a, b] of [
    [owner, stranger],
    [stranger, owner]
  ]) {
    await db.query(
      "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
      [a, b]
    );
    await db.query(
      "insert into public.notifications(user_id,type,reference_id,actor_user_id) values($1,'wall_post_reply',$2,$3) on conflict(user_id,type,reference_id) do update set actor_user_id=excluded.actor_user_id",
      [owner, post, stranger]
    );
    await login(owner);
    assert.equal(
      (await rpc("list_notifications", [50])).filter(
        n => n.type === "wall_post_reply" && n.referenceId === post
      ).length,
      0
    );
    await root();
    await db.exec("delete from public.user_blocks");
  }
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [owner]
  );
  await login(stranger);
  await assert.rejects(activity(post), /WALL_POST_UNAVAILABLE/);
  assert.deepEqual(await grouped([post]), {});
  await assert.rejects(
    db.query("select public.wall_post_interaction_allowed($1,$2)", [
      stranger,
      post
    ]),
    /permission denied/
  );
});
