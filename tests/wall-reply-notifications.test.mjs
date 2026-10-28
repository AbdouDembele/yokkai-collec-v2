import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("wall reply notifications are recipient-only, idempotent, coalesced and follow live privacy", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const users = Array.from(
    { length: 4 },
    (_, i) => `79020000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  const [owner, alice, bob, stranger] = users;
  for (const [i, id] of users.entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo: `ReplyNotify${i}` })]
    );
    await db.query(
      "update public.user_profiles set is_public=false where user_id=$1",
      [id]
    );
  }
  for (const friend of [alice, bob])
    await db.query(
      "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
      [owner, friend]
    );
  const post = crypto.randomUUID();
  const postBody = "This private post must not appear in notifications";
  const replyBody = "This private reply must not appear in notifications";
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,$3)",
    [post, owner, postBody]
  );
  const as = async (user, sql, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const reply = (user, id = crypto.randomUUID()) =>
    as(user, "select public.publish_wall_post_reply($1,$2,$3)", [
      post,
      id,
      replyBody
    ]);
  const list = async user =>
    (
      await as(user, "select public.list_notifications() value")
    )[0].value.filter(item => item.type === "wall_post_reply");
  const clearCooldown = () =>
    db.exec(
      "update public.wall_post_replies set created_at=clock_timestamp()-interval '10 seconds'"
    );
  const firstReply = crypto.randomUUID();
  await reply(alice, firstReply);
  const first = (await list(owner))[0];
  assert.ok(first);
  assert.equal(first.referenceId, post);
  assert.equal(first.actorPseudo, "ReplyNotify1");
  assert.equal(first.readAt, null);
  assert.ok(!JSON.stringify(first).includes(postBody));
  assert.ok(!JSON.stringify(first).includes(replyBody));
  assert.equal((await list(alice)).length, 0);
  assert.equal((await list(stranger)).length, 0);
  assert.equal(
    (
      await as(
        stranger,
        "select count(*)::int n from public.notifications where type='wall_post_reply'"
      )
    )[0].n,
    0
  );
  await as(owner, "select public.mark_notification_read($1)", [first.id]);
  const readAt = (await list(owner))[0].readAt;
  assert.ok(readAt);
  await reply(alice, firstReply);
  assert.equal(
    (await list(owner))[0].readAt,
    readAt,
    "Retrying a confirmed reply must not notify again"
  );
  await reply(owner);
  assert.equal(
    (await list(owner))[0].readAt,
    readAt,
    "No self-reply notification"
  );
  const bobReply = crypto.randomUUID();
  await reply(bob, bobReply);
  const latest = await list(owner);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].id, first.id);
  assert.equal(latest[0].actorPseudo, "ReplyNotify2");
  assert.equal(latest[0].readAt, null);
  await db.query(
    "update public.friendships set status='pending' where friend_id=$1",
    [bob]
  );
  assert.equal((await list(owner)).length, 0);
  await db.query(
    "update public.friendships set status='accepted' where friend_id=$1",
    [bob]
  );
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    bob
  ]);
  assert.equal((await list(owner)).length, 0);
  await db.query("update auth.users set banned_until=null where id=$1", [bob]);
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    owner
  ]);
  assert.equal((await list(owner)).length, 0);
  await db.query("update auth.users set banned_until=null where id=$1", [
    owner
  ]);
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [bob, owner]
  );
  assert.equal((await list(owner)).length, 0);
  await db.exec("delete from public.user_blocks");
  await as(owner, "select public.block_user($1)", [bob]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.notifications where type='wall_post_reply' and user_id=$1",
        [owner]
      )
    ).rows[0].n,
    0
  );
  await db.exec("delete from public.user_blocks");
  await clearCooldown();
  await reply(alice);
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [alice]
  );
  assert.equal((await list(owner)).length, 0);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.notifications where type='wall_post_reply' and user_id=$1",
        [owner]
      )
    ).rows[0].n,
    0
  );
  // block_user may remove the relationship; restore only the fixture friendship.
  await db.query(
    "delete from public.friendships where (user_id=$1 and friend_id=$2) or (user_id=$2 and friend_id=$1)",
    [owner, bob]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [owner, bob]
  );
  await clearCooldown();
  const deleteReply = crypto.randomUUID();
  await reply(bob, deleteReply);
  assert.equal((await list(owner)).length, 1);
  await as(bob, "select public.delete_wall_post_reply($1,$2)", [
    post,
    deleteReply
  ]);
  // One older reply by Bob remains, so the coalesced notification stays valid.
  await as(bob, "select public.delete_wall_post_reply($1,$2)", [
    post,
    bobReply
  ]);
  assert.equal((await list(owner)).length, 0);
  await clearCooldown();
  await reply(bob);
  await as(owner, "select public.delete_profile_wall_post($1)", [post]);
  assert.equal((await list(owner)).length, 0);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.notifications where type='wall_post_reply' and reference_id=$1",
        [post]
      )
    ).rows[0].n,
    0
  );
});

test("wall reply notification opens the player's wall without leaking content", () => {
  const require = createRequire(import.meta.url);
  const exports = {};
  const source = ts.transpileModule(
    readFileSync("components/topbar.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name =>
      name === "react" || name === "react/jsx-runtime" ? require(name) : {}
  });
  const input = {
    id: "note",
    type: "wall_post_reply",
    referenceId: "post",
    actorPseudo: "Kitsune",
    readAt: null,
    createdAt: "2026-10-21T10:00:00Z",
    cardName: null,
    achievementName: null
  };
  const item = exports.notificationItem(input);
  assert.equal(item.title, "New reply to your post");
  assert.equal(item.text, "Kitsune replied to your post.");
  assert.equal(item.href, "/profile?tab=wall");
  assert.equal(item.kind, "reply");
  assert.equal(item.read, false);
  assert.equal(
    exports.notificationItem({ ...input, readAt: input.createdAt }).read,
    true
  );
  assert.equal(
    exports.notificationItem({ ...input, actorPseudo: null }).text,
    "A friend replied to your post."
  );
});

test("only the selected like heart receives the pink accent", () => {
  const source = readFileSync("components/wall-post-interactions.tsx", "utf8");
  const css = readFileSync("styles/wall-interactions.css", "utf8");
  assert.match(
    source,
    /className="yk-post-like"\s+aria-pressed=\{activity\?\.likedByMe/
  );
  assert.match(
    css,
    /\.yk-post-actions > \.yk-post-like\[aria-pressed="true"\] > svg\s*\{\s*color: #ff6b9d;/
  );
  assert.match(
    source,
    /fill=\{activity\?\.likedByMe \? "currentColor" : "none"\}/
  );
});
