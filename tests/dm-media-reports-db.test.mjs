import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

// #379 (C1): DM reports with access checks and minimal snapshots; admin hides a
// DM or a wall media item for everyone, with audit and Storage cleanup receipt.
test("DM and wall media reports: access, limits, admin hiding and audit", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // Supabase Storage object ids, outside the replay's minimal stub.
  await db.exec(`alter table storage.objects add column id uuid default gen_random_uuid();
    alter table auth.users add column banned_until timestamptz;`);
  const id = n => `37900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [viewer, sender, outsider, admin] = [1, 2, 3, 4].map(id);
  for (const [i, user] of [viewer, sender, outsider, admin].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `DmReport${i}` })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [viewer, sender]
  );
  const gif = "https://media.giphy.com/media/abc123/giphy.gif";
  const [text, gifOnly, own] = [10, 11, 12].map(id);
  await db.query(
    "insert into public.private_messages(id,sender_id,recipient_id,body,gif_url) values($1,$2,$3,'Rude words',null),($4,$2,$3,'',$5),($6,$3,$2,'Mine',null)",
    [text, sender, viewer, gifOnly, gif, own]
  );
  const as = async user => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const root = () =>
    db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
  const report = async (user, kind, key) =>
    (
      await db.query(
        "select public.report_user($1,'harassment',$2,$3,'',false) id",
        [user, kind, key]
      )
    ).rows[0].id;
  const moderate = async reportId =>
    (
      await db.query(
        "select public.admin_moderate_reported_content($1) result",
        [reportId]
      )
    ).rows[0].result;
  const one = async (sql, args) => (await db.query(sql, args)).rows[0];

  // Reporting a DM: recipient of a visible conversation, authored by the target.
  await as(viewer);
  const dmReport = await report(sender, "private_message", text);
  await assert.rejects(
    report(sender, "private_message", text),
    /REPORT_DUPLICATE/
  );
  await assert.rejects(
    report(sender, "private_message", own),
    /REPORT_INVALID/,
    "own message"
  );
  await assert.rejects(
    report(outsider, "private_message", gifOnly),
    /REPORT_INVALID/,
    "wrong author"
  );
  await as(outsider);
  await assert.rejects(
    report(sender, "private_message", text),
    /REPORT_INVALID/,
    "not a participant"
  );
  await root();
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [sender, viewer]
  );
  await as(viewer);
  await assert.rejects(
    report(sender, "private_message", gifOnly),
    /REPORT_INVALID/,
    "conversation no longer visible"
  );
  await root();
  await db.exec("delete from public.user_blocks");
  assert.deepEqual(
    (
      await one("select snapshot from public.user_reports where id=$1", [
        dmReport
      ])
    ).snapshot,
    { message: "Rude words", gifUrl: null },
    "content only"
  );

  // Existing shared limit: 10 reports per reporter and UTC day.
  await db.query(
    "insert into public.user_reports(reporter_id,reported_id,reason,context_type,context_id) select $1,$2,'spam','wall_post',gen_random_uuid() from generate_series(1,9)",
    [viewer, sender]
  );
  await as(viewer);
  await assert.rejects(
    report(sender, "private_message", gifOnly),
    /REPORT_LIMIT/
  );
  await root();
  await db.query(
    "delete from public.user_reports where context_type='wall_post'"
  );

  // Admin hides the DM for both participants.
  await as(viewer);
  await assert.rejects(moderate(dmReport), /ADMIN_REQUIRED/);
  await as(admin);
  assert.deepEqual(await moderate(dmReport), {
    alreadyRemoved: false,
    mediaPaths: []
  });
  assert.equal((await moderate(dmReport)).alreadyRemoved, true);
  await as(viewer);
  const page = (
    await one("select public.get_private_messages($1) page", [sender])
  ).page;
  const hidden = page.items.find(item => item.id === text);
  assert.equal(hidden.moderated, true);
  assert.equal(hidden.text, "");
  assert.equal(hidden.gifUrl, null);
  assert.equal(page.items.find(item => item.id === gifOnly).moderated, false);
  await assert.rejects(
    report(sender, "private_message", text),
    /REPORT_DUPLICATE|REPORT_INVALID/
  );
  await root();
  assert.equal(
    (
      await one(
        "select count(*)::int n from public.admin_audit_logs where action='private_message.moderate' and metadata->>'report_id'=$1",
        [dmReport]
      )
    ).n,
    1
  );
  assert.equal(
    (
      await one(
        "select snapshot->>'message' m from public.user_reports where id=$1",
        [dmReport]
      )
    ).m,
    "Rude words",
    "the snapshot keeps the evidence"
  );

  // Wall: only the media goes, the text stays; no text left means delete instead.
  await db.query(
    "update public.user_profiles set is_public=true where user_id=$1",
    [sender]
  );
  const [post, gifReply, gifOnlyReply] = [20, 21, 22].map(id);
  const image = `${sender}/${id(60)}.png`;
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2)",
    [image, sender]
  );
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body,media_path) values($1,$2,'Look at this',$3)",
    [post, sender, image]
  );
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,gif_url) values($1,$2,$3,'Reply text',$4),($5,$2,$3,'',$4)",
    [gifReply, post, sender, gif, gifOnlyReply]
  );
  await as(viewer);
  const postReport = await report(sender, "wall_post", post);
  const replyReport = await report(sender, "wall_reply", gifReply);
  const bareReport = await report(sender, "wall_reply", gifOnlyReply);
  await as(admin);
  assert.equal(
    (
      await one("select public.admin_get_reported_wall_media($1) p", [
        postReport
      ])
    ).p,
    image
  );
  assert.deepEqual(await moderate(postReport), {
    alreadyRemoved: false,
    mediaPaths: [image]
  });
  // The removed object is now authorized for the trusted server cleanup.
  assert.equal(
    (
      await one("select public.authorize_wall_reply_media_cleanup($1) p", [
        image
      ])
    ).p,
    image
  );
  assert.deepEqual(await moderate(postReport), {
    alreadyRemoved: true,
    mediaPaths: [image]
  });
  assert.equal(
    (
      await one("select public.admin_get_reported_wall_media($1) p", [
        postReport
      ])
    ).p,
    null
  );
  assert.deepEqual(await moderate(replyReport), {
    alreadyRemoved: false,
    mediaPaths: []
  });
  await assert.rejects(moderate(bareReport), /MODERATION_TEXT_REQUIRED/);
  await as(viewer);
  await assert.rejects(
    db.query("select public.admin_get_reported_wall_media($1)", [postReport]),
    /ADMIN_REQUIRED/
  );
  await root();
  assert.deepEqual(
    await one(
      "select body,media_path,gif_url from public.profile_wall_posts where id=$1",
      [post]
    ),
    { body: "Look at this", media_path: null, gif_url: null }
  );
  assert.deepEqual(
    await one("select body,gif_url from public.wall_post_replies where id=$1", [
      gifReply
    ]),
    { body: "Reply text", gif_url: null }
  );
  assert.equal(
    (
      await one("select gif_url from public.wall_post_replies where id=$1", [
        gifOnlyReply
      ])
    ).gif_url,
    gif,
    "refused removal changes nothing"
  );
  assert.equal(
    (
      await one(
        "select count(*)::int n from public.admin_audit_logs where action='wall_media.moderate'"
      )
    ).n,
    2
  );
  // A DM report cannot target a wall item and vice versa through the admin RPC.
  await as(admin);
  await assert.rejects(
    db.query(
      "select public.admin_moderate_reported_content('00000000-0000-4000-8000-000000000000')"
    ),
    /REPORT_INVALID/
  );
});
