import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("wall posts and private media enforce dynamic privacy, ownership, bounds, export and account removal", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // GIFs verified by the server route (#379 C2); unverified ones are refused.
  await db.exec(
    "insert into public.giphy_gif_ratings(gif_id,rating) values ('demo','g')"
  );
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const [owner, friend, stranger] = [1, 2, 3].map(
    n => `75000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  const postId = n => `75000000-0000-4000-8001-${String(n).padStart(12, "0")}`;
  for (const [n, id] of [owner, friend, stranger].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `WallPlayer${n}` })]
    );
  await db.exec(
    "grant select,insert,delete on storage.objects to authenticated; grant all on storage.objects to service_role"
  );
  const login = async id => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const publish = async (id, body = "Bonjour", path = null, gif = null) =>
    (
      await db.query(
        "select public.publish_profile_wall_post($1,$2,$3,$4) value",
        [id, body, path, gif]
      )
    ).rows[0].value;
  const read = async (id = owner, cursor = null) =>
    (
      await db.query("select public.get_profile_wall($1,$2,$3,20) value", [
        id,
        cursor?.at ?? null,
        cursor?.id ?? null
      ])
    ).rows[0].value;
  await login(owner);
  const first = await publish(
    postId(1),
    "<script>alert(1)</script>\nUn souvenir"
  );
  assert.equal(first.text, "<script>alert(1)</script>\nUn souvenir");
  assert.deepEqual(
    await publish(postId(1), first.text),
    first,
    "retry is idempotent even inside the rate-limit window"
  );
  await assert.rejects(publish(postId(1), "changed"), /WALL_POST_INVALID/);
  await assert.rejects(publish(postId(2)), /WALL_RATE_LIMITED/);
  await assert.rejects(publish(postId(2), ""), /WALL_POST_INVALID/);
  await assert.rejects(
    publish(postId(2), "x".repeat(3001)),
    /WALL_POST_INVALID/
  );
  await assert.rejects(
    publish(postId(2), "", null, "https://media.giphy.com.evil.test/x"),
    /WALL_GIF_INVALID/
  );
  await assert.rejects(
    db.query(
      "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'forged')",
      [postId(3), stranger]
    ),
    /permission denied/
  );
  await login(stranger);
  assert.equal(
    (await read()).items.length,
    1,
    "public wall is visible to other players"
  );
  await assert.rejects(
    db.query("select public.delete_profile_wall_post($1)", [postId(1)]),
    /WALL_POST_NOT_FOUND/
  );
  await login(owner);
  await db.query("select public.set_profile_privacy(false)");
  await login(stranger);
  await assert.rejects(read(), /WALL_PRIVATE/);
  assert.equal(
    (await db.query("select * from public.profile_wall_posts")).rows.length,
    0,
    "direct table reads cannot bypass privacy"
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [owner, friend]
  );
  await login(friend);
  assert.equal((await read()).items.length, 1);
  await db.exec("reset role");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [friend, owner]
  );
  await login(friend);
  await assert.rejects(read(), /WALL_PRIVATE/);
  await db.exec("reset role");
  await db.query("delete from public.user_blocks");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [owner, friend]
  );
  await login(friend);
  await assert.rejects(read(), /WALL_PRIVATE/);
  await db.exec("reset role");
  await db.query("delete from public.user_blocks");
  await db.query("delete from public.friendships");
  await login(friend);
  await assert.rejects(read(), /WALL_PRIVATE/);
  await login(owner);
  assert.equal((await read()).items.length, 1);
  const media = `${owner}/${postId(8)}.png`;
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2)",
    [media, owner]
  );
  await db.exec("reset role");
  await db.query(
    "update public.profile_wall_posts set created_at=now()-interval '10 seconds'"
  );
  await login(owner);
  const image = await publish(postId(2), "Une image", media);
  await db.exec("reset role");
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [owner, friend]
  );
  await login(friend);
  assert.equal(
    (
      await db.query(
        "select name from storage.objects where bucket_id='profile-wall-media'"
      )
    ).rows.length,
    1,
    "friends can read private uploaded media"
  );
  await login(stranger);
  assert.equal(
    (
      await db.query(
        "select name from storage.objects where bucket_id='profile-wall-media'"
      )
    ).rows.length,
    0,
    "non-friends cannot fetch/list private media"
  );
  await login(owner);
  await db.query("select public.set_profile_privacy(true)");
  await login(stranger);
  assert.equal(
    (
      await db.query(
        "select name from storage.objects where bucket_id='profile-wall-media'"
      )
    ).rows.length,
    1
  );
  await login(owner);
  await db.query("select public.set_profile_privacy(false)");
  await login(stranger);
  assert.equal(
    (
      await db.query(
        "select name from storage.objects where bucket_id='profile-wall-media'"
      )
    ).rows.length,
    0,
    "public-to-private revokes media access without changing the URL"
  );
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2)",
      [`${owner}/${postId(9)}.png`, stranger]
    ),
    /WALL_MEDIA_INVALID|row-level security/
  );
  await login(owner);
  await db.query("delete from storage.objects where name=$1", [media]);
  assert.equal(
    (await db.query("select name from storage.objects where name=$1", [media]))
      .rows.length,
    1,
    "a published attachment is immutable until its post is removed"
  );
  await db.exec("reset role");
  await db.query(
    "update public.profile_wall_posts set created_at=now()-interval '10 seconds'"
  );
  await login(owner);
  await assert.rejects(
    publish(postId(3), "fake", `${owner}/${postId(99)}.png`),
    /WALL_MEDIA_INVALID/
  );
  const gif = await publish(
    postId(3),
    "Ma réaction",
    null,
    "https://media.giphy.com/media/demo/giphy.gif"
  );
  assert.ok(gif.gifUrl);
  await db.exec("reset role");
  for (let i = 10; i < 35; i++)
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body,created_at) values($1,$2,$3,'2026-01-01')",
      [postId(i), owner, `page ${i}`]
    );
  await login(owner);
  const a = await read();
  const b = await read(owner, a.next);
  assert.equal(a.items.length, 20);
  assert.equal(b.items.length, 8);
  assert.equal(b.next, null);
  assert.equal(
    new Set([...a.items, ...b.items].map(p => p.id)).size,
    28,
    "keyset paging does not repeat posts with equal timestamps"
  );
  await db.exec("reset role; set role service_role");
  const exportId = postId(70);
  await db.query("select public.reserve_data_export($1,$2)", [owner, exportId]);
  const exp = (
    await db.query("select public.build_data_export($1,$2) value", [
      owner,
      exportId
    ])
  ).rows[0].value;
  assert.equal(exp.wall_posts.length, 28);
  assert.equal(exp.wall_files.length, 1);
  assert.ok(
    !JSON.stringify(exp.wall_files).includes(media),
    "export does not include expiring access URLs or internal file paths"
  );
  await login(owner);
  assert.equal(
    JSON.parse(
      (
        await db.query("select public.delete_profile_wall_post($1) path", [
          image.id
        ])
      ).rows[0].path
    ).mediaPaths[0],
    media
  );
  await db.query("delete from storage.objects where name=$1", [media]);
  assert.equal(
    (await db.query("select * from storage.objects where name=$1", [media]))
      .rows.length,
    0
  );
  await db.exec("reset role; set role anon");
  await assert.rejects(read(), /permission denied/);
  await assert.rejects(
    db.query("select * from public.profile_wall_posts"),
    /permission denied/
  );
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false); set role service_role"
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2)",
    [media, owner]
  );
  await db.query("select public.begin_account_deletion($1)", [owner]);
  const manifest = (
    await db.query("select public.prepare_account_deletion($1) value", [owner])
  ).rows[0].value;
  assert.deepEqual(manifest, [{ bucket: "profile-wall-media", name: media }]);
  await login(owner);
  await assert.rejects(publish(postId(90)), /WALL_UNAVAILABLE|ACCOUNT_DELETED/);
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)"
  );
  await db.query("delete from auth.users where id=$1", [owner]);
  assert.equal(
    (await db.query("select count(*) n from public.profile_wall_posts")).rows[0]
      .n,
    0
  );
});

test("wall hourly/post-count limits and private upload quota are enforced on the server", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // GIFs verified by the server route (#379 C2); unverified ones are refused.
  await db.exec(
    "insert into public.giphy_gif_ratings(gif_id,rating) values ('demo','g')"
  );
  const owner = "75000000-0000-4000-8002-000000000001";
  const id = n => `75000000-0000-4000-8003-${String(n).padStart(12, "0")}`;
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"WallQuota"}\')',
    [owner]
  );
  for (let n = 1; n <= 30; n++)
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body,created_at) values($1,$2,'rate fixture',now()-interval '10 seconds')",
      [id(n), owner]
    );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select public.publish_profile_wall_post($1,'rate',null,null)", [
      id(40)
    ]),
    /WALL_RATE_LIMITED/
  );
  await db.exec(
    "reset role; update public.profile_wall_posts set created_at='2026-01-01'"
  );
  for (let n = 31; n <= 500; n++)
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body) values($1,$2,'count fixture')",
      [id(n), owner]
    );
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select public.publish_profile_wall_post($1,'count',null,null)", [
      id(501)
    ]),
    /WALL_FULL/
  );
  await db.exec(
    "reset role; grant insert,select on storage.objects to authenticated; set role authenticated"
  );
  for (let n = 1; n <= 16; n++)
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2)",
      [`${owner}/${id(n)}.png`, owner]
    );
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('profile-wall-media',$1,$2)",
      [`${owner}/${id(17)}.png`, owner]
    ),
    /WALL_STORAGE_FULL/
  );
});
