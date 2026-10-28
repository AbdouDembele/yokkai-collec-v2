import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import { deleteReportedWallContent } from "../lib/server/admin-wall-content-core.mjs";

test("wall reports enforce live ACLs, snapshots, quotas and audited admin deletion", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const id = n => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [viewer, author, stranger, admin, privateAuthor] = [1, 2, 3, 4, 5].map(
    id
  );
  for (const [i, user] of [
    viewer,
    author,
    stranger,
    admin,
    privateAuthor
  ].entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `WallReport${i}` })]
    );
    await db.query(
      "insert into public.user_profiles(user_id,pseudo,is_public) values($1,$2,false) on conflict(user_id) do update set is_public=false",
      [user, `WallReport${i}`]
    );
  }
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [viewer, author]
  );
  const post = id(20),
    own = id(21),
    privatePost = id(22),
    reply = id(23);
  const image = `${author}/${id(60)}.png`,
    replyImage = `${author}/${id(61)}.png`;
  for (const [key, user, media] of [
    [post, author, image],
    [own, viewer, null],
    [privatePost, privateAuthor, null]
  ]) {
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body,media_path,created_at) values($1,$2,'Reported story',$3,'2026-10-25T01:00:00Z')",
      [key, user, media]
    );
  }
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,gif_url,created_at) values($1,$2,$3,'Reported reply','https://media.giphy.com/media/example/giphy.gif','2026-10-25T01:01:00Z')",
    [reply, post, author]
  );
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body) values($1,$2,$3,'My own reply')",
    [id(27), post, viewer]
  );
  const login = async user => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const root = () => db.exec("reset role");
  const report = async (user, kind, key, block = false) =>
    (
      await db.query(
        "select public.report_user($1,'spam',$2,$3,'Please review',$4) id",
        [user, kind, key, block]
      )
    ).rows[0].id;
  await login(viewer);
  const reportId = await report(author, "wall_post", post);
  await assert.rejects(report(author, "wall_post", post), /REPORT_DUPLICATE/);
  await assert.rejects(report(viewer, "wall_post", own), /REPORT_INVALID/);
  await assert.rejects(report(viewer, "wall_reply", id(27)), /REPORT_INVALID/);
  await assert.rejects(report(author, "wall_post", id(999)), /REPORT_INVALID/);
  await assert.rejects(
    report(privateAuthor, "wall_post", privatePost),
    /REPORT_INVALID/
  );
  await assert.rejects(report(stranger, "wall_post", post), /REPORT_INVALID/);
  const replyReport = await report(author, "wall_reply", reply);
  await root();
  const snapshot = (
    await db.query("select snapshot from public.user_reports where id=$1", [
      reportId
    ])
  ).rows[0].snapshot;
  assert.equal(snapshot.message, "Reported story");
  assert.equal(snapshot.hasMedia, true);
  assert.equal(snapshot.author.id, author);
  assert.equal(snapshot.createdAt, "2026-10-25T01:00:00+00:00");
  assert.ok(!("mediaPath" in snapshot));
  const replySnapshot = (
    await db.query("select snapshot from public.user_reports where id=$1", [
      replyReport
    ])
  ).rows[0].snapshot;
  assert.equal(replySnapshot.postId, post);
  assert.equal(replySnapshot.message, "Reported reply");
  assert.equal(
    replySnapshot.gifUrl,
    "https://media.giphy.com/media/example/giphy.gif"
  );
  await login(stranger);
  await assert.rejects(report(author, "wall_post", post), /REPORT_INVALID/);
  await root();
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [author]
  );
  await login(stranger);
  await report(author, "wall_post", post);
  await root();
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [stranger, author]
  );
  for (const [first, second] of [
    [stranger, author],
    [author, stranger]
  ]) {
    await root();
    await db.exec("delete from public.user_blocks");
    await db.query(
      "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
      [first, second]
    );
    await login(stranger);
    await assert.rejects(report(author, "wall_post", post), /REPORT_INVALID/);
    await assert.rejects(report(author, "wall_reply", reply), /REPORT_INVALID/);
  }
  await root();
  await db.exec("delete from public.user_blocks");
  await login(stranger);
  await report(author, "wall_reply", reply, true);
  await root();
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.user_blocks where blocker_id=$1 and blocked_id=$2",
        [stranger, author]
      )
    ).rows[0].n,
    1
  );
  // A reporter cannot read a reply whose parent is private, even if its author is public.
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body) values($1,$2,$3,'Private thread')",
    [id(24), privatePost, author]
  );
  await login(viewer);
  await assert.rejects(report(author, "wall_reply", id(24)), /REPORT_INVALID/);
  // Shared daily quota across contexts; pre-seed eight additional reports for the stranger.
  await root();
  await db.exec("delete from public.user_blocks");
  await db.query(
    "insert into public.user_reports(reporter_id,reported_id,reason,context_type,context_id) select $1,$2,'spam','wall_post',gen_random_uuid() from generate_series(1,8)",
    [stranger, author]
  );
  await login(stranger);
  await assert.rejects(report(author, "wall_reply", id(24)), /REPORT_INVALID/);
  await root();
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'Quota')",
    [id(25), author]
  );
  await login(stranger);
  await assert.rejects(report(author, "wall_post", id(25)), /REPORT_LIMIT/);
  // Owner deletion makes the content unavailable while preserving the report snapshot.
  await root();
  await db.query("delete from public.wall_post_replies where id=$1", [reply]);
  await login(viewer);
  await assert.rejects(report(author, "wall_reply", reply), /REPORT_INVALID/);
  await assert.rejects(
    db.query("select public.admin_delete_reported_wall_content($1)", [
      reportId
    ]),
    /ADMIN_REQUIRED/
  );
  await assert.rejects(
    db.query("select public.delete_wall_content_core('wall_post',$1)", [post]),
    /permission denied/
  );
  await root();
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,media_path) values($1,$2,$3,'Image reply',$4)",
    [id(26), post, author, replyImage]
  );
  await login(admin);
  const deleted = (
    await db.query(
      "select public.admin_delete_reported_wall_content($1) result",
      [reportId]
    )
  ).rows[0].result;
  assert.equal(deleted.alreadyDeleted, false);
  assert.deepEqual(deleted.mediaPaths.sort(), [image, replyImage].sort());
  const retry = (
    await db.query(
      "select public.admin_delete_reported_wall_content($1) result",
      [reportId]
    )
  ).rows[0].result;
  assert.equal(retry.alreadyDeleted, true);
  assert.deepEqual(retry.mediaPaths.sort(), [image, replyImage].sort());
  await root();
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.profile_wall_posts where id=$1",
        [post]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.wall_post_replies where post_id=$1",
        [post]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.admin_audit_logs where action='wall_content.delete' and metadata->>'report_id'=$1",
        [reportId]
      )
    ).rows[0].n,
    1
  );
  assert.equal(
    (
      await db.query(
        "select snapshot->>'message' value from public.user_reports where id=$1",
        [reportId]
      )
    ).rows[0].value,
    "Reported story"
  );
  await login(viewer);
  await assert.rejects(report(author, "wall_post", post), /REPORT_INVALID/);
  await login(admin);
  assert.equal(
    (
      await db.query(
        "select public.admin_delete_reported_wall_content($1) result",
        [replyReport]
      )
    ).rows[0].result.alreadyDeleted,
    true
  );
  await root();
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,media_path) values($1,$2,$3,'Another reply',$4)",
    [id(28), id(25), author, replyImage]
  );
  await login(viewer);
  const liveReplyReport = await report(author, "wall_reply", id(28));
  await login(admin);
  const removedReply = (
    await db.query(
      "select public.admin_delete_reported_wall_content($1) result",
      [liveReplyReport]
    )
  ).rows[0].result;
  assert.equal(removedReply.alreadyDeleted, false);
  assert.deepEqual(removedReply.mediaPaths, [replyImage]);
  await root();
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.wall_post_replies where id=$1",
        [id(28)]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.admin_audit_logs where action='wall_content.delete' and metadata->>'report_id'=$1",
        [liveReplyReport]
      )
    ).rows[0].n,
    1
  );
  await login(admin);
  const cleaned = [];
  const cleanup = await deleteReportedWallContent(
    {
      rpc: async (name, args) => {
        if (name === "authorize_wall_reply_media_cleanup") {
          assert.ok([image, replyImage].includes(args.p_path));
          // This Storage fixture contains paths, not storage.objects rows.
          // Exact-object SQL authorization is exercised in wall-orphan-media-db.
          return { data: args.p_path, error: null };
        }
        assert.equal(name, "admin_delete_reported_wall_content");
        return {
          data: (
            await db.query(
              "select public.admin_delete_reported_wall_content($1) result",
              [args.p_report_id]
            )
          ).rows[0].result,
          error: null
        };
      }
    },
    reportId,
    () => ({
      storage: {
        from: bucket => {
          assert.equal(bucket, "profile-wall-media");
          return {
            remove: async paths => {
              cleaned.push(...paths);
              return { error: null };
            }
          };
        }
      }
    })
  );
  assert.equal(cleanup.ok, true);
  assert.deepEqual(cleaned.sort(), [image, replyImage].sort());
});
