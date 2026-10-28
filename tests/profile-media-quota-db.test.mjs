import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const pro = "37600000-0000-4000-8000-0000000000af",
  basic = "37600000-0000-4000-8000-000000000002",
  other = "37600000-0000-4000-8000-000000000003";
const scope = "test:acct_quota:price_quota";
const base = "https://api.yokkai-collec.com/storage/v1/object/public/avatars/";
const MiB = 1024 * 1024;

test("#376: no direct avatars upload, 30/24 h and 50 MiB quotas, ban check and stale cleanup", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // Supabase Storage/Auth columns and grants outside the replay's minimal stubs.
  await db.exec(`alter table auth.users add column banned_until timestamptz;
    alter table storage.objects add column metadata jsonb, add column created_at timestamptz default now();
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const [id, pseudo] of [
    [pro, "QuotaPro"],
    [basic, "QuotaBasic"],
    [other, "QuotaOther"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("select public.billing_set_entitlement_scope($1,true)", [
    scope
  ]);
  await db.query(
    "insert into public.billing_accounts(user_id,scope,stripe_customer_id,active,status,period_end,verified_at) values($1,$2,'cus_quotafixture',true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
    [pro, scope]
  );
  let sequence = 0;
  const reserve = user => {
    const path = `${user}/avatar-00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}.png`;
    return db.query(
      "insert into public.profile_media_assets(path,user_id,purpose,mime_type,animated,public_url) values($1,$2,'avatar','image/png',false,$3)",
      [path, user, base + path]
    );
  };
  const age = (user, interval) =>
    db.query(
      `update public.profile_media_assets set created_at=clock_timestamp()-interval '${interval}' where user_id=$1`,
      [user]
    );
  const stored = (user, name, bytes, interval = "0 seconds") =>
    db.query(
      `insert into storage.objects(bucket_id,name,owner_id,metadata,created_at) values('avatars',$1,$2,$3,clock_timestamp()-interval '${interval}')`,
      [`${user}/${name}`, user, { size: bytes }]
    );

  await t.test("the legacy direct Pro upload path is closed", async () => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      pro
    ]);
    for (const name of ["banner.gif", "anything-1.png", "avatar.png"])
      await assert.rejects(
        db.query(
          "insert into storage.objects(bucket_id,name,owner_id) values('avatars',$1,$2)",
          [`${pro}/${name}`, pro]
        ),
        /row-level security/,
        name
      );
    await db.exec("reset role");
  });

  await t.test("30 validated uploads per rolling 24 hours", async () => {
    for (let batch = 0; batch < 3; batch++) {
      for (let i = 0; i < 10; i++) await reserve(basic);
      // Stay under the existing 10 per 10 minutes limit.
      await age(basic, "1 hour");
    }
    await assert.rejects(reserve(basic), /PROFILE_MEDIA_QUOTA_EXCEEDED/);
    await age(basic, "25 hours");
    await reserve(basic);
    await db.query("delete from public.profile_media_assets where user_id=$1", [
      basic
    ]);
  });

  await t.test(
    "50 MiB stored, counting the incoming file at 4 MiB",
    async () => {
      await stored(basic, "big-1.png", 40 * MiB);
      await stored(basic, "big-2.png", 6 * MiB);
      await stored(other, "elsewhere.png", 40 * MiB);
      await reserve(basic); // 46 MiB + 4 MiB = 50 MiB: allowed
      await stored(basic, "big-3.png", 1);
      await assert.rejects(reserve(basic), /PROFILE_MEDIA_QUOTA_EXCEEDED/);
      await db.query("delete from storage.objects where owner_id=$1", [basic]);
      await reserve(basic);
    }
  );

  await t.test(
    "a banned account cannot reserve through the server path",
    async () => {
      await db.query(
        "update auth.users set banned_until='infinity' where id=$1",
        [basic]
      );
      await age(basic, "25 hours");
      await assert.rejects(reserve(basic), /ACCOUNT_BANNED/);
      await db.query("update auth.users set banned_until=null where id=$1", [
        basic
      ]);
    }
  );

  await t.test(
    "only unreferenced files older than 24 h are released",
    async () => {
      await db.query("delete from storage.objects");
      await stored(pro, "avatar-current.png", 10, "2 days");
      await stored(pro, "banner-current.png", 10, "2 days");
      await stored(pro, "background-current.png", 10, "2 days");
      await stored(pro, "old-unused.png", 10, "2 days");
      await stored(pro, "frame-key.png", 10, "2 days");
      await stored(pro, "banner.gif", 10, "2 days"); // legacy, unreferenced
      await stored(pro, "fresh-unused.png", 10, "1 hour");
      await stored(other, "old-unused.png", 10, "2 days");
      // Forged or unusual names: old and unreferenced, yet never claimable.
      for (const name of [
        `${pro}/../${other}/old-unused.png`,
        `${pro}/..%2f${other}/old-unused.png`,
        `${pro}/%2e%2e/old-unused.png`,
        `${pro}/sub/old-unused.png`,
        `${pro}//old-unused.png`,
        `${pro}/OLD-UNUSED.PNG`,
        `${pro.toUpperCase()}/old-unused.png`,
        `${pro}`
      ])
        await db.query(
          "insert into storage.objects(bucket_id,name,owner_id,metadata,created_at) values('avatars',$1,$2,'{}',clock_timestamp()-interval '2 days')",
          [name, pro]
        );
      for (const bucket of ["card-images", "profile-wall-media"])
        await db.query(
          "insert into storage.objects(bucket_id,name,owner_id,metadata,created_at) values($1,$2,$3,'{}',clock_timestamp()-interval '2 days')",
          [bucket, `${pro}/old-unused.png`, pro]
        );
      // Reference rows written directly: the profile write paths are tested elsewhere.
      await db.query(
        "update public.user_profiles set avatar_url=$2,banner_url=$3,banner_frame_source=$4 where user_id=$1",
        [
          pro,
          `${base}${pro}/avatar-current.png?v=1`,
          `${base}${pro}/banner-current.png`,
          `${base}${pro}/frame-key.png`
        ]
      );
      await db.exec(
        "alter table public.profile_customizations disable trigger guard_pro_profile_style"
      );
      await db.query(
        "insert into public.profile_customizations(user_id,style) values($1,$2)",
        [pro, { backgroundUrl: `${base}${pro}/background-current.png` }]
      );
      await db.exec(
        "alter table public.profile_customizations enable trigger guard_pro_profile_style"
      );
      assert.deepEqual(
        (
          await db.query(
            "select public.claim_stale_profile_media($1) as paths",
            [pro]
          )
        ).rows[0].paths,
        [`${pro}/banner.gif`, `${pro}/old-unused.png`]
      );
      for (const user of [other, null])
        assert.deepEqual(
          (
            await db.query(
              "select public.claim_stale_profile_media($1) as paths",
              [user]
            )
          ).rows[0].paths,
          user ? [`${other}/old-unused.png`] : []
        );
      await db.exec("set role authenticated");
      await assert.rejects(
        db.query("select public.claim_stale_profile_media($1)", [pro]),
        /permission denied/
      );
      await db.exec("reset role");
    }
  );
});
