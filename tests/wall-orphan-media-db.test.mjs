import { serverOnly } from "./security-definer-allowlist.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import { purgeOrphanWallMedia } from "../scripts/admin/purge-orphan-wall-media.mjs";

const id = n => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("cascade media receipts are exact, owner-scoped, retryable and deny rebinding", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table storage.objects add column id uuid default gen_random_uuid(); alter table storage.objects add column metadata jsonb; alter table storage.objects add column created_at timestamptz default now()"
  );
  const owner = id(1),
    other = id(2),
    post = id(10),
    reply = id(11),
    ownPath = `${owner}/${id(20)}.png`,
    replyPath = `${other}/${id(21)}.png`;
  for (const [n, user] of [owner, other].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `Orphan${n}` })]
    );
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2),('profile-wall-media',$3,$4)",
    [ownPath, owner, replyPath, other]
  );
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body,media_path) values($1,$2,'Parent',$3)",
    [post, owner, ownPath]
  );
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,media_path) values($1,$2,$3,'Reply',$4)",
    [reply, post, other, replyPath]
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
  const authorize = async path =>
    (
      await db.query(
        "select public.authorize_wall_reply_media_cleanup($1) result",
        [path]
      )
    ).rows[0].result;
  await login(other);
  await assert.rejects(remove(), /WALL_POST_NOT_FOUND/);
  await login(owner);
  const result = await remove();
  assert.deepEqual(result.mediaPaths.sort(), [ownPath, replyPath].sort());
  assert.equal(result.mediaPath, ownPath);
  assert.equal(result.alreadyDeleted, false);
  for (const path of result.mediaPaths)
    assert.equal(await authorize(path), path);
  assert.deepEqual((await remove()).mediaPaths.sort(), result.mediaPaths);
  await login(other);
  await assert.rejects(authorize(replyPath), /WALL_MEDIA_INVALID/);
  await db.exec("reset role");
  await db.query("insert into public.admin_users(user_id) values($1)", [other]);
  await login(other);
  assert.equal(
    await authorize(ownPath),
    ownPath,
    "another admin can finish authorized content cleanup"
  );
  await db.exec("reset role");
  await db.query("delete from public.admin_users where user_id=$1", [other]);
  await login(other);
  assert.deepEqual(
    (await remove()).mediaPaths,
    [],
    "another caller cannot recover the author's manifest"
  );
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)"
  );
  await assert.rejects(
    db.query(
      "insert into public.profile_wall_posts(id,user_id,body,media_path) values($1,$2,'Rebind',$3)",
      [id(30), other, replyPath]
    ),
    /WALL_MEDIA_INVALID/
  );
  await db.query("delete from storage.objects where name=$1", [replyPath]);
  await login(owner);
  assert.equal(
    await authorize(replyPath),
    null,
    "already removed is idempotent"
  );
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)"
  );
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2)",
      [replyPath, other]
    ),
    /WALL_MEDIA_INVALID/
  );
  // Fault injection models pre-existing corruption; normal uploads are fenced.
  await db.exec(
    "alter table storage.objects disable trigger wall_storage_cleanup_guard"
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2)",
    [replyPath, other]
  );
  await db.exec(
    "alter table storage.objects enable trigger wall_storage_cleanup_guard"
  );
  await login(owner);
  await assert.rejects(
    authorize(replyPath),
    /WALL_MEDIA_INVALID/,
    "recreated object has no old authorization"
  );
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)"
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
});

test("orphan inventory respects references, grace, active leases and safe Storage-only apply", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table storage.objects add column id uuid default gen_random_uuid(); alter table storage.objects add column metadata jsonb; alter table storage.objects add column created_at timestamptz default now()"
  );
  for (const [signature, roles] of Object.entries(serverOnly)) {
    assert.deepEqual(roles, ["service_role"]);
    assert.deepEqual(
      (
        await db.query(
          "select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') u,has_function_privilege('service_role',$1,'EXECUTE') s",
          [signature]
        )
      ).rows[0],
      { a: false, u: false, s: true }
    );
  }
  const owner = id(101);
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [owner, JSON.stringify({ pseudo: "PurgeFixture" })]
  );
  const paths = Array.from(
    { length: 6 },
    (_, n) => `${owner}/${id(110 + n)}.png`
  );
  for (const path of paths)
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id,metadata,created_at) values('profile-wall-media',$1,$2,jsonb_build_object('size',12),now()-interval '25 hours')",
      [path, owner]
    );
  await db.query(
    "update storage.objects set created_at=now()-interval '1 hour' where name=$1",
    [paths[1]]
  );
  await db.query(
    "insert into public.profile_wall_posts(id,user_id,body,media_path) values($1,$2,'Bound',$3)",
    [id(130), owner, paths[2]]
  );
  await db.query(
    "insert into public.wall_post_replies(id,post_id,user_id,body,media_path) values($1,$2,$3,'Bound reply',$4)",
    [id(131), id(130), owner, paths[3]]
  );
  await db.query(
    "insert into public.wall_reply_media_cleanup(media_path,user_id,object_id,created_at) select name,$1,id::text,case when name=$2 then now() else now()-interval '25 hours' end from storage.objects where name in ($2,$3)",
    [owner, paths[4], paths[5]]
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select public.get_orphan_wall_media()"),
    /permission denied/
  );
  await db.exec("reset role; set role service_role");
  let deletes = 0;
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, "get_orphan_wall_media");
      return {
        data: (
          await db.query("select public.get_orphan_wall_media($1,$2) result", [
            args.p_after,
            args.p_claim
          ])
        ).rows[0].result
      };
    },
    storage: {
      from: bucket => {
        assert.equal(bucket, "profile-wall-media");
        return {
          remove: async names => {
            deletes++;
            await db.query(
              "delete from storage.objects where bucket_id='profile-wall-media' and name=any($1)",
              [names]
            );
            return { error: null };
          }
        };
      }
    }
  };
  await db.exec(
    "reset role; grant select,delete on storage.objects to service_role; set role service_role"
  );
  const logs = [];
  const dry = await purgeOrphanWallMedia(client, { log: s => logs.push(s) });
  assert.deepEqual(dry, { count: 2, bytes: 24, deleted: 0 });
  assert.equal(deletes, 0);
  assert.deepEqual(logs.slice(0, 2), [paths[0], paths[5]]);
  await assert.rejects(
    purgeOrphanWallMedia(client, {
      apply: true,
      confirm: async () => "no",
      log: () => {}
    }),
    /Cancelled/
  );
  assert.equal(deletes, 0);
  const applied = await purgeOrphanWallMedia(client, {
    apply: true,
    confirm: async () => "PURGE",
    log: () => {}
  });
  assert.equal(applied.deleted, 2);
  assert.equal(deletes, 1);
  assert.deepEqual(
    (await db.query("select name from storage.objects order by name")).rows.map(
      r => r.name
    ),
    paths.slice(1, 5)
  );
  const again = await purgeOrphanWallMedia(client, { log: () => {} });
  assert.equal(again.count, 0);
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)"
  );
  // A claimed old draft is fenced against publication and same-path upload,
  // while a fresh draft remains untouched by the sweep.
  await db.query(
    "update storage.objects set created_at=now()-interval '25 hours' where name=$1",
    [paths[1]]
  );
  await db.exec("set role service_role");
  const claimed = await client.rpc("get_orphan_wall_media", {
    p_after: null,
    p_claim: true
  });
  assert.equal(claimed.data.items[0].name, paths[1]);
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)"
  );
  await assert.rejects(
    db.query(
      "insert into public.profile_wall_posts(id,user_id,body,media_path) values($1,$2,'Late draft',$3)",
      [id(140), owner, paths[1]]
    ),
    /WALL_MEDIA_INVALID/
  );
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name) values('profile-wall-media',$1)",
      [paths[1]]
    ),
    /WALL_MEDIA_INVALID/
  );
});
