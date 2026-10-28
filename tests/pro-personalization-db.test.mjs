import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("paid cosmetics are server-only, bounded, owner-scoped and hidden after expiry", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const owner = "6c000000-0000-4000-8000-000000000001",
    other = "6c000000-0000-4000-8000-000000000002";
  const scope = "test:acct_fixture:price_fixture";
  for (const [id, pseudo] of [
    [owner, "CosmeticOwner"],
    [other, "CosmeticBasic"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const login = async id => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const admin = () => db.exec("reset role");
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values('cosmetic-fixture','Fixture','ANIME/MANGA','Fixture','SSR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  const copy = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'SSR') returning id",
      [owner, card]
    )
  ).rows[0].id;
  await login(owner);
  for (const table of [
    "billing_accounts",
    "billing_entitlement_config",
    "profile_customizations",
    "profile_media_assets"
  ]) {
    await assert.rejects(
      db.query(`select * from public.${table}`),
      /permission denied/
    );
    await assert.rejects(
      db.query(`delete from public.${table}`),
      /permission denied/
    );
  }
  await assert.rejects(
    db.query(
      "select public.set_card_custom_image($1,'https://i.imgur.com/example.png')",
      [copy]
    ),
    /PRO_REQUIRED/
  );
  await assert.rejects(
    db.query("select public.update_profile_appearance('',null,'{}',null,$1)", [
      `https://api.yokkai-collec.com/storage/v1/object/public/avatars/${owner}/banner.gif`
    ]),
    /PRO_REQUIRED/
  );
  await admin();
  await assert.rejects(
    db.query(
      'insert into public.profile_customizations(user_id,style) values($1,\'{"effect":"neon"}\')',
      [owner]
    ),
    /PRO_REQUIRED/
  );
  const reserve = (user, purpose, animated = false) => {
    const path = `${user}/${purpose}-00000000-0000-4000-8000-000000000001.${animated ? "gif" : "png"}`;
    return db.query(
      "insert into public.profile_media_assets(path,user_id,purpose,mime_type,animated,public_url) values($1,$2,$3,$4,$5,$6) returning public_url",
      [
        path,
        user,
        purpose,
        animated ? "image/gif" : "image/png",
        animated,
        `http://localhost:54321/storage/v1/object/public/avatars/${path}`
      ]
    );
  };
  await assert.rejects(reserve(owner, "avatar", true), /PRO_REQUIRED/);
  await assert.rejects(reserve(owner, "banner"), /PRO_REQUIRED/);
  const staticAvatar = (await reserve(owner, "avatar")).rows[0].public_url;
  await login(owner);
  await db.query("select public.update_profile('', $1,'{}',null)", [
    staticAvatar
  ]);
  await assert.rejects(
    db.query("select public.update_profile('', $1,'{}',null)", [
      `https://api.yokkai-collec.com/storage/v1/object/public/avatars/${owner}/avatar.gif`
    ]),
    /PRO_REQUIRED/
  );
  await login(other);
  await assert.rejects(
    db.query("select public.update_profile('', $1,'{}',null)", [staticAvatar]),
    /AVATAR_URL_INVALID/
  );
  await assert.rejects(
    db.query(
      "select public.set_card_custom_image($1,'https://i.imgur.com/example.png')",
      [copy]
    ),
    /CARD_NOT_OWNED/
  );
  await admin();
  await db.query("select public.billing_set_entitlement_scope($1,true)", [
    scope
  ]);
  await db.query(
    "insert into public.billing_accounts(user_id,scope,stripe_customer_id,active,status,period_end,verified_at) values($1,$2,'cus_cosmeticfixture',true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
    [owner, scope]
  );
  for (const style of [
    { font: "evil" },
    { effect: null },
    { color: "url(javascript:evil)" },
    { badges: ["unknown"] },
    { badges: ["moon", "moon"] },
    { backgroundUrl: "https://evil.test/image.png" },
    { isPro: true }
  ])
    await assert.rejects(
      db.query(
        "insert into public.profile_customizations(user_id,style) values($1,$2)",
        [owner, JSON.stringify(style)]
      ),
      /PROFILE_STYLE_INVALID/
    );
  const background = (await reserve(owner, "background")).rows[0].public_url;
  await db.query(
    "insert into public.profile_customizations(user_id,style) values($1,$2)",
    [
      owner,
      JSON.stringify({
        font: "rounded",
        effect: "neon",
        color: "#aabbcc",
        badges: ["crystal"],
        backgroundUrl: background
      })
    ]
  );
  const animatedAvatar = (await reserve(owner, "avatar", true)).rows[0]
    .public_url;
  const banner = (await reserve(owner, "banner", true)).rows[0].public_url;
  await login(owner);
  await db.query(
    "select public.update_profile_appearance('Pro', $1,'{}',null,$2)",
    [animatedAvatar, banner]
  );
  await db.query(
    "select public.set_card_custom_image($1,'https://i.pinimg.com/fixture.gif')",
    [copy]
  );
  const profile = (await db.query("select public.get_profile(null) value"))
    .rows[0].value;
  assert.equal(profile.isPro, true);
  assert.equal(profile.profileStyle.style.effect, "neon");
  const auction = (
    await db.query("select public.create_auction($1,10,60) value", [copy])
  ).rows[0].value;
  const chat = (
    await db.query("select public.get_auction_chat($1) value", [auction])
  ).rows[0].value;
  assert.equal(
    chat.participants.find(item => item.userId === owner).profileStyle.active,
    true
  );
  await db.query("select public.cancel_auction($1)", [auction]);
  await db.query(
    "select public.publish_profile_wall_post(gen_random_uuid(),'Hello',null,null)"
  );
  assert.equal(
    (await db.query("select public.get_profile_wall($1) value", [owner]))
      .rows[0].value.items[0].profileStyle.active,
    true
  );
  await admin();
  await db.query(
    "update public.billing_accounts set period_end=clock_timestamp()-interval '1 second' where user_id=$1",
    [owner]
  );
  await login(owner);
  const expired = (await db.query("select public.get_profile(null) value"))
    .rows[0].value;
  assert.equal(expired.isPro, false);
  assert.deepEqual(expired.profileStyle.style, {});
  await assert.rejects(
    db.query(
      "select public.set_card_custom_image($1,'https://i.imgur.com/new.png')",
      [copy]
    ),
    /PRO_REQUIRED/
  );
  await db.query("select public.set_card_custom_image($1,null)", [copy]);
  await db.query(
    "select public.update_profile_appearance('Changed biography', $1,'{}',null,$2)",
    [animatedAvatar, banner]
  );
  await admin();
  assert.equal(
    (
      await db.query(
        "select style->>'effect' value from public.profile_customizations where user_id=$1",
        [owner]
      )
    ).rows[0].value,
    "neon",
    "downgrade hides but does not destroy saved styles"
  );
  // Model the Storage grants/RLS that Supabase owns outside application migrations.
  await db.exec(
    "grant select,insert,update on storage.objects to authenticated; alter table storage.objects enable row level security"
  );
  await login(other);
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('avatars',$1,$2)",
      [`${other}/avatar.gif`, other]
    ),
    /row-level security/
  );
  await admin();
  await db.query(
    "update public.billing_accounts set period_end=clock_timestamp()+interval '1 month',verified_at=clock_timestamp() where user_id=$1",
    [owner]
  );
  await login(owner);
  // #376: the legacy direct Pro upload path is closed; only the validated
  // server endpoint writes avatars objects.
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('avatars',$1,$2)",
      [`${owner}/banner.gif`, owner]
    ),
    /row-level security/
  );
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values('avatars',$1,$2)",
      [`${owner}/avatar-00000000-0000-4000-8000-000000000001.png`, owner]
    ),
    /row-level security/
  );
  await admin();
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [other]
  );
  await assert.rejects(reserve(other, "avatar"), /ACCOUNT_DELETED/);
  await assert.rejects(
    db.query(
      "insert into public.profile_customizations(user_id,style) values($1,'{}')",
      [other]
    ),
    /ACCOUNT_DELETED/
  );
  // The export keeps one explicit owner-scoped snapshot including Pro settings;
  // neither private billing identifiers nor another owner's settings leak.
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const exportId = "6c000000-0000-4000-8000-000000000099";
  await db.query("select public.reserve_data_export($1,$2)", [owner, exportId]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      owner,
      exportId
    ])
  ).rows[0].value;
  assert.equal(exported.profile.regular_pack_interval_seconds, 300);
  assert.equal(exported.profile.decision_pack_interval_seconds, 43200);
  assert.equal(exported.profile_customizations[0].style.effect, "neon");
  assert.equal(exported.profile_media.length, 4);
  assert.ok(
    exported.profile_media.every(asset => asset.public_url.includes(owner))
  );
  assert.doesNotMatch(
    JSON.stringify(exported),
    /stripe_customer_id|lease_token|acct_fixture|price_fixture/
  );
  await db.query("select public.finish_data_export($1,$2,false)", [
    owner,
    exportId
  ]);
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("select public.begin_account_deletion($1)", [owner]);
  const cancellationGuard = (
    await db.query(
      "select to_regprocedure('public.billing_claim_deletion(uuid,text)') is not null present"
    )
  ).rows[0].present;
  if (cancellationGuard) {
    await assert.rejects(
      db.query("select public.prepare_account_deletion($1)", [owner]),
      /BILLING_CANCELLATION_REQUIRED/
    );
    const receipt = (
      await db.query("select public.billing_claim_deletion($1,$2) value", [
        owner,
        scope
      ])
    ).rows[0].value;
    await db.query("select public.billing_confirm_deletion($1,$2)", [
      receipt.id,
      receipt.lease_token
    ]);
    await db.query("select public.billing_release($1,$2)", [
      receipt.id,
      receipt.lease_token
    ]);
  }
  await db.query("select public.prepare_account_deletion($1)", [owner]);
  for (const table of ["profile_customizations", "profile_media_assets"])
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from public.${table} where user_id=$1`,
          [owner]
        )
      ).rows[0].n,
      0
    );
});
