import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const id = n => `97000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("direct post moderation requires a live admin, audits once and preserves exact media cleanup", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column banned_until timestamptz; alter table storage.objects add column id uuid default gen_random_uuid()"
  );
  const owner = id(1),
    admin = id(2),
    stranger = id(3),
    post = id(10),
    reply = id(11);
  const paths = [`${owner}/${id(20)}.png`, `${stranger}/${id(21)}.gif`];
  for (const [n, user] of [owner, admin, stranger].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `Moderation${n}` })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2),('profile-wall-media',$3,$4)",
    [paths[0], owner, paths[1], stranger]
  );
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body,media_path) values($1,$2,'Parent',$3)",
    [post, owner, paths[0]]
  );
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,media_path) values($1,$2,$3,'Reply',$4)",
    [reply, post, stranger, paths[1]]
  );
  const login = async user => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const remove = async () =>
    JSON.parse(
      (
        await db.query("select public.delete_profile_wall_post($1) result", [
          post
        ])
      ).rows[0].result
    );
  await login("");
  await assert.rejects(remove(), /AUTH_REQUIRED/);
  await login(stranger);
  await assert.rejects(remove(), /WALL_POST_NOT_FOUND/);
  await db.exec("reset role");
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [admin]
  );
  await login(admin);
  await assert.rejects(remove(), /ACCOUNT_BANNED/);
  await db.exec("reset role");
  await db.query("update auth.users set banned_until=null where id=$1", [
    admin
  ]);
  await db.query("delete from public.admin_users where user_id=$1", [admin]);
  await login(admin);
  await assert.rejects(
    remove(),
    /WALL_POST_NOT_FOUND/,
    "a stale admin UI cannot grant deletion"
  );
  await db.exec("reset role");
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await login(admin);
  const result = await remove();
  assert.equal(result.alreadyDeleted, false);
  assert.equal(result.authorId, owner);
  assert.deepEqual(result.mediaPaths.sort(), paths.sort());
  for (const path of paths)
    assert.equal(
      (
        await db.query(
          "select public.authorize_wall_reply_media_cleanup($1) result",
          [path]
        )
      ).rows[0].result,
      path
    );
  const retry = await remove();
  assert.equal(retry.alreadyDeleted, true);
  assert.deepEqual(retry.mediaPaths.sort(), paths);
  await login(stranger);
  assert.deepEqual((await remove()).mediaPaths, []);
  await assert.rejects(
    db.query("select public.authorize_wall_reply_media_cleanup($1)", [
      paths[1]
    ]),
    /WALL_MEDIA_INVALID/
  );
  await db.exec("reset role");
  for (const table of ["profile_wall_posts", "wall_post_replies"])
    assert.equal(
      (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,
      0
    );
  const audit = (
    await db.query(
      "select admin_user_id,action,metadata from public.admin_audit_logs where action='wall_content.delete'"
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].admin_user_id, admin);
  assert.equal(audit[0].metadata.target_user_id, owner);
  assert.equal(audit[0].metadata.context_id, post);
  assert.equal(audit[0].metadata.context_type, "wall_post");
  assert.deepEqual(audit[0].metadata.mediaPaths.sort(), paths);
  assert.deepEqual(
    (
      await db.query(
        "select has_function_privilege('anon','public.delete_profile_wall_post(uuid)','EXECUTE') anon,has_function_privilege('authenticated','public.delete_profile_wall_post(uuid)','EXECUTE') player"
      )
    ).rows[0],
    { anon: false, player: true }
  );
});
