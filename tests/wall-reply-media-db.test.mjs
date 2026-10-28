import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("reply images/GIFs preserve ownership, parent/author privacy, retries, notifications, export and deletion", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // GIFs verified by the server route (#379 C2); unverified ones are refused.
  await db.exec(
    "insert into public.giphy_gif_ratings(gif_id,rating) values ('demo','g')"
  );
  await db.exec(
    "alter table storage.objects add column metadata jsonb; alter table auth.users add column banned_until timestamptz; create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz); grant select,insert,delete on storage.objects to authenticated"
  );
  const id = n => `89600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [owner, author, stranger] = [1, 2, 3].map(id),
    post = id(10),
    imageReply = id(11),
    gifReply = id(12),
    gif = "https://media.giphy.com/media/demo/giphy.gif";
  for (const [n, user] of [owner, author, stranger].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `ReplyMedia${n}` })]
    );
  await db.exec("update public.user_profiles set is_public=false");
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted'),($1,$3,'accepted')",
    [owner, author, stranger]
  );
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'Original')",
    [post, owner]
  );
  const login = async user => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const age = async () => {
    await db.exec(
      "reset role; update public.wall_post_replies set created_at=now()-interval '10 seconds'"
    );
    await login(author);
  };
  const publish = async (reply, text = "", path = null, url = null) =>
    (
      await db.query(
        "select public.publish_wall_post_reply_media($1,$2,$3,$4,$5) value",
        [post, reply, text, path, url]
      )
    ).rows[0].value;
  const path = `${author}/${id(20)}.png`;
  await login(author);
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id,metadata) values('profile-wall-media',$1,$2,$3)",
    [path, author, JSON.stringify({ size: 8, mimetype: "image/png" })]
  );
  await assert.rejects(
    db.exec("select * from public.wall_post_replies"),
    /permission denied/
  );
  await assert.rejects(publish(id(30)), /WALL_REPLY_INVALID/);
  await assert.rejects(
    publish(id(30), "x".repeat(1001), null, gif),
    /WALL_REPLY_INVALID/
  );
  for (const url of [
    "https://media.giphy.com.evil.test/x",
    "https://media.giphy.com@evil.test/x",
    "javascript:alert(1)",
    "http://media.giphy.com/x"
  ])
    await assert.rejects(publish(id(30), "", null, url), /WALL_GIF_INVALID/);
  await assert.rejects(publish(id(30), "", path, gif), /WALL_REPLY_INVALID/);
  await assert.rejects(
    publish(id(30), "", `${owner}/${id(20)}.png`),
    /WALL_MEDIA_INVALID/
  );
  await assert.rejects(
    publish(id(30), "", `${author}/${id(21)}.png`),
    /WALL_MEDIA_INVALID/
  );
  await assert.rejects(
    db.query("select public.publish_profile_wall_post($1,'',$2,null)", [
      id(30),
      `${author}/${id(21)}.png`
    ]),
    /WALL_MEDIA_INVALID/,
    "the original post publication API still rejects missing uploads"
  );
  const first = await publish(imageReply, "", path);
  assert.equal(first.replyCount, 1);
  assert.equal(first.items[0].text, "");
  assert.equal(first.items[0].hasMedia, true);
  assert.equal(first.items[0].mediaPath, path);
  assert.equal(
    (await publish(imageReply, "", path)).replyCount,
    1,
    "retry is idempotent inside cooldown"
  );
  await assert.rejects(
    publish(imageReply, "changed", path),
    /WALL_REPLY_INVALID/
  );
  await assert.rejects(
    publish(imageReply, "", null, gif),
    /WALL_REPLY_INVALID/
  );
  await assert.rejects(
    db.query("select public.publish_wall_post_reply($1,$2,'')", [
      post,
      imageReply
    ]),
    /WALL_REPLY_INVALID/
  );
  await assert.rejects(
    publish(gifReply, "", null, gif),
    /WALL_REPLY_RATE_LIMITED/
  );
  await db.query("delete from storage.objects where name=$1", [path]);
  assert.equal(
    (await db.query("select name from storage.objects where name=$1", [path]))
      .rows.length,
    1,
    "referenced images cannot be deleted"
  );
  await login(owner);
  const visible = (
    await db.query("select public.get_wall_post_activity($1) value", [post])
  ).rows[0].value;
  assert.equal(visible.items[0].hasMedia, true);
  assert.equal(
    visible.items[0].mediaPath,
    null,
    "other players receive an opaque media endpoint, not the private path"
  );
  assert.equal(
    (
      await db.query("select public.get_wall_reply_media($1) path", [
        imageReply
      ])
    ).rows[0].path,
    path
  );
  assert.equal(
    (await db.query("select name from storage.objects where name=$1", [path]))
      .rows.length,
    1
  );
  assert.equal(
    (
      await db.query("select public.list_notifications(20) value")
    ).rows[0].value.filter(n => n.type === "wall_post_reply").length,
    1
  );
  await login(stranger);
  assert.equal(
    (await db.query("select public.get_wall_post_activity($1) value", [post]))
      .rows[0].value.items.length,
    1,
    "reply author privacy does not hide replies from a reader of the parent"
  );
  assert.equal(
    (
      await db.query("select public.get_wall_reply_media($1) value", [
        imageReply
      ])
    ).rows[0].value,
    path
  );
  assert.equal(
    (await db.query("select name from storage.objects where name=$1", [path]))
      .rows.length,
    1
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [owner, author]
  );
  await login(owner);
  await assert.rejects(
    db.query("select public.get_wall_reply_media($1)", [imageReply]),
    /WALL_POST_UNAVAILABLE/
  );
  assert.equal(
    (await db.query("select name from storage.objects where name=$1", [path]))
      .rows.length,
    0
  );
  await db.exec("reset role; delete from public.user_blocks");
  await db.query(
    "delete from public.friendships where user_id=$1 and friend_id=$2",
    [owner, author]
  );
  await login(author);
  await assert.rejects(
    db.query("select public.get_wall_reply_media($1)", [imageReply]),
    /WALL_POST_UNAVAILABLE/
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [owner, author]
  );
  await age();
  await assert.rejects(publish(id(31), "reuse", path), /WALL_MEDIA_INVALID/);
  await assert.rejects(
    db.query("select public.publish_profile_wall_post($1,'reuse',$2,null)", [
      id(32),
      path
    ]),
    /WALL_MEDIA_INVALID/
  );
  const second = await publish(gifReply, "", null, gif);
  assert.equal(second.replyCount, 2);
  assert.equal(second.items[0].gifUrl, gif);
  assert.equal((await publish(gifReply, "", null, gif)).replyCount, 2);
  await db.exec("reset role;set role service_role");
  await db.query("select public.reserve_data_export($1,$2)", [author, id(40)]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      author,
      id(40)
    ])
  ).rows[0].value;
  assert.equal(exported.wall_post_replies.length, 2);
  assert.ok(exported.wall_post_replies.some(r => r.has_image));
  assert.ok(exported.wall_post_replies.some(r => r.gif_url === gif));
  assert.ok(!JSON.stringify(exported.wall_post_replies).includes(path));
  await assert.rejects(
    db.query("select public.build_data_export_without_reply_media($1,$2)", [
      author,
      id(40)
    ]),
    /permission denied/
  );
  await db.exec("reset role");
  const moderatedReply = id(13);
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body) values($1,$2,$3,'Moderated reply')",
    [moderatedReply, post, author]
  );
  await login(owner);
  await db.query("select public.delete_wall_post_reply($1,$2)", [
    post,
    moderatedReply
  ]);
  assert.ok(
    !(
      await db.query("select public.get_wall_post_activity($1) value", [post])
    ).rows[0].value.items.some(reply => reply.id === moderatedReply)
  );
  assert.equal(
    (await db.query("select public.get_wall_post_activity($1) value", [post]))
      .rows[0].value.replyCount,
    2,
    "post owner can delete another player's reply while preserving the others"
  );
  await login(author);
  const removed = (
    await db.query("select public.delete_wall_post_reply($1,$2) value", [
      post,
      imageReply
    ])
  ).rows[0].value;
  assert.equal(removed.deletedMediaPath, path);
  assert.equal(removed.replyCount, 1);
  await db.query("delete from storage.objects where name=$1", [path]);
  assert.equal(
    (await db.query("select name from storage.objects where name=$1", [path]))
      .rows.length,
    0
  );
  await assert.rejects(
    db.query("select public.get_wall_reply_media($1)", [imageReply]),
    /WALL_POST_UNAVAILABLE/
  );
  await age();
  // Bad metadata cannot smuggle an oversize upload or an executable format.
  for (const metadata of [
    { size: 6291457, mimetype: "image/png" },
    { size: 8, mimetype: "image/svg+xml" },
    { size: "invalid", mimetype: "image/png" }
  ]) {
    await db.exec("reset role");
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id,metadata) values('profile-wall-media',$1,$2,$3)",
      [path, author, JSON.stringify(metadata)]
    );
    await login(author);
    await assert.rejects(publish(id(50), "", path), /WALL_MEDIA_INVALID/);
    await db.query("delete from storage.objects where name=$1", [path]);
  }
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)"
  );
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [author]
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.wall_post_replies where user_id=$1",
        [author]
      )
    ).rows[0].n,
    0
  );
  await login(owner);
  assert.equal(
    (
      await db.query("select public.list_notifications(20) value")
    ).rows[0].value.filter(n => n.type === "wall_post_reply").length,
    0
  );
  await db.query("select public.delete_profile_wall_post($1)", [post]);
  await login(stranger);
  await assert.rejects(publish(id(60), "", null, gif), /WALL_POST_UNAVAILABLE/);
  await db.exec("reset role;set role anon");
  await assert.rejects(
    db.query("select public.get_wall_reply_media($1)", [gifReply]),
    /permission denied/
  );
});
