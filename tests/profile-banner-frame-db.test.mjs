import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("banner crops persist atomically, bind to their source and keep profile/storage/privacy permissions", async t => {
  // Historical contract: uploads/catalogue choices were allowed before owned-only banners.
  // Keep every original assertion; the current policy is tested on the full replay separately.
  const migrations = readdirSync(
    new URL("../supabase/migrations/", import.meta.url)
  )
    .filter(
      name =>
        name.endsWith(".sql") &&
        name <= "20261016000000_profile_banner_frame.sql"
    )
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  const owner = "78000000-0000-4000-8000-000000000001";
  const viewer = "78000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "CropOwner"],
    [viewer, "CropViewer"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('banner-frame-card','Banner frame','ANIME/MANGA','Framing','C','https://example.test/portrait.png','test') returning id"
    )
  ).rows[0].id;
  const login = async id => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const frame = { x: 35, y: 72, zoom: 1.4 };
  const save = async (
    value = frame,
    { url = null, id = card, bio = "Crop saved", avatar = null } = {}
  ) =>
    (
      await db.query(
        "select public.update_profile_appearance_framed($1,$2,'{}'::uuid[],$3,$4,$5::jsonb) value",
        [bio, avatar, id, url, JSON.stringify(value)]
      )
    ).rows[0].value;
  const details = async id =>
    (await db.query("select public.get_profile_details($1) value", [id]))
      .rows[0].value;
  await login(owner);
  assert.deepEqual((await save()).bannerFrame, frame);
  assert.deepEqual((await details(owner)).bannerFrame, frame);
  for (const rotation of [0, 90, 180, 270]) {
    const rotated = { ...frame, rotation };
    assert.deepEqual((await save(rotated)).bannerFrame, rotated);
    assert.deepEqual((await details(owner)).bannerFrame, rotated);
  }
  await save(frame);
  for (const rotation of [-90, 45, 360, "90", null, true]) {
    await assert.rejects(save({ ...frame, rotation }), /BANNER_FRAME_INVALID/);
  }
  assert.deepEqual((await details(owner)).bannerFrame, frame);
  for (const invalid of [
    [],
    {},
    "bad",
    { x: 50, y: 50 },
    { ...frame, x: -1 },
    { ...frame, y: 101 },
    { ...frame, zoom: 0 },
    { ...frame, zoom: 4.1 },
    { ...frame, x: "50" },
    { ...frame, user_id: viewer }
  ])
    await assert.rejects(save(invalid), /BANNER_FRAME_INVALID/);
  assert.deepEqual((await details(owner)).bannerFrame, frame);
  await assert.rejects(save(frame, { id: null }), /BANNER_FRAME_INVALID/);
  await assert.rejects(
    save(frame, {
      url: `https://api.yokkai-collec.com/storage/v1/object/public/avatars/${viewer}/banner.png`
    }),
    /BANNER_URL_INVALID/
  );
  await assert.rejects(
    save(
      { ...frame, x: 90 },
      { avatar: "http://evil.test/avatar.png", bio: "Must roll back" }
    ),
    /AVATAR_URL_INVALID/
  );
  assert.equal(
    (await db.query("select public.get_profile(null) value")).rows[0].value.bio,
    "Crop saved"
  );
  assert.deepEqual((await details(owner)).bannerFrame, frame);
  await assert.rejects(
    db.query(
      "update public.user_profiles set banner_frame='{}' where user_id=$1",
      [owner]
    ),
    /permission denied/
  );
  await assert.rejects(
    db.query("select banner_frame_source from public.user_profiles"),
    /permission denied/
  );
  await login(viewer);
  assert.deepEqual((await details(owner)).bannerFrame, frame);
  assert.equal((await details(viewer)).bannerFrame, null);
  await save({ ...frame, x: 88 });
  assert.deepEqual(
    (await details(owner)).bannerFrame,
    frame,
    "another user can only modify their own crop"
  );
  await db.query("select public.block_user($1)", [owner]);
  assert.equal(
    (await details(owner)).bannerFrame,
    null,
    "blocked viewers receive no new crop metadata"
  );
  await login(owner);
  const url = `https://api.yokkai-collec.com/storage/v1/object/public/avatars/${owner}/banner.gif?v=123`;
  assert.equal(
    (await save(frame, { url, id: null })).bannerUrl,
    url,
    "GIF URL remains intact; no raster export"
  );
  assert.deepEqual((await details(owner)).bannerFrame, frame);
  await db.query(
    "select public.update_profile_appearance('',null,'{}'::uuid[],$1,null)",
    [card]
  );
  assert.equal(
    (await details(owner)).bannerFrame,
    null,
    "old clients cannot apply framing from another image"
  );
  await save(frame);
  assert.equal((await save(null)).bannerFrame, null);
  assert.equal((await details(owner)).bannerFrame, null);
  await save(frame);
  await db.exec(
    "reset role; create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz); set role service_role"
  );
  const request = "78000000-0000-4000-8001-000000000001";
  await db.query("select public.reserve_data_export($1,$2)", [owner, request]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      owner,
      request
    ])
  ).rows[0].value;
  assert.deepEqual(exported.profile.banner_frame, frame);
  await db.exec("reset role");
  await db.query("select public.begin_account_deletion($1)", [owner]);
  await login(owner);
  await assert.rejects(save(), /ACCOUNT_DELETED/);
  await db.exec("set role anon");
  await assert.rejects(save(), /permission denied/);
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false); set role authenticated"
  );
  await assert.rejects(save(), /AUTH_REQUIRED/);
});
