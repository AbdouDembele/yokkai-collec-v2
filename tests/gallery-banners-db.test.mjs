import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("gallery banners preserve owner-only access, framing and owned card restrictions", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const owner = "7a000000-0000-4000-8000-000000000001";
  const other = "7a000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "GalleryOwner"],
    [other, "GalleryOther"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('gallery-banner','Gallery card','ANIME/MANGA','Gallery','SSR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SSR')",
    [owner, card]
  );
  const login = async id => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  // Exercise the same ownership/crop contract with a paid uploader when the
  // server entitlement migration is present; no security assertion is removed.
  if (
    (
      await db.query(
        "select to_regprocedure('public.billing_set_entitlement_scope(text,boolean)') present"
      )
    ).rows[0].present
  ) {
    const scope = "test:acct_gallery:price_gallery";
    await db.query("select public.billing_set_entitlement_scope($1,true)", [
      scope
    ]);
    await db.query(
      "insert into public.billing_accounts(user_id,scope,active,status,period_end,verified_at) values($1,$2,true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
      [owner, scope]
    );
  }
  const frame = { x: 23, y: 78, zoom: 0.6, rotation: 270 };
  const prefix =
    "https://api.yokkai-collec.com/storage/v1/object/public/avatars/";
  const url = prefix + owner + "/banner.gif?v=123";
  const save = async (banner = url, crop = frame, cardId = null) =>
    (
      await db.query(
        "select public.update_profile_appearance_framed('Gallery',null,'{}'::uuid[],$1,$2,$3::jsonb) value",
        [cardId, banner, JSON.stringify(crop)]
      )
    ).rows[0].value;
  const details = async () =>
    (await db.query("select public.get_profile_details(null) value")).rows[0]
      .value;
  await login(owner);
  for (const ext of ["jpg", "jpeg", "png", "webp", "gif"]) {
    const candidate = prefix + owner + "/banner." + ext + "?v=123";
    assert.equal((await save(candidate)).bannerUrl, candidate);
    assert.deepEqual((await details()).bannerFrame, frame);
  }
  for (const invalid of [
    url.replace(owner, other),
    url.replace("https:", "http:"),
    url.replace("api.yokkai-collec.com", "evil.test"),
    url.replace("banner.gif", "avatar.gif"),
    url.replace("banner.gif", "../banner.gif"),
    url.replace("banner.gif", "%2e%2e/banner.gif"),
    url.replace("banner.gif", "banner.svg"),
    url + "#fragment",
    url + "&extra=1",
    url + "x".repeat(2048),
    "data:image/png;base64,AA",
    "javascript:alert(1)"
  ])
    await assert.rejects(save(invalid), /BANNER_URL_INVALID/);
  await assert.rejects(save(url, frame, card), /BANNER_URL_INVALID/);
  await assert.rejects(
    save(url, { ...frame, rotation: 45 }),
    /BANNER_FRAME_INVALID/
  );
  assert.equal((await details()).bannerUrl, url);
  assert.deepEqual((await details()).bannerFrame, frame);
  await db.query(
    "select public.update_profile_appearance('Gallery',null,'{}'::uuid[],null,$1)",
    [url]
  );
  assert.deepEqual(
    (await details()).bannerFrame,
    frame,
    "saving the same upload keeps its crop"
  );
  await save(url.replace("v=123", "v=124"));
  await db.query(
    "select public.update_profile_appearance('Gallery',null,'{}'::uuid[],null,$1)",
    [url]
  );
  assert.equal(
    (await details()).bannerFrame,
    null,
    "a new source never inherits another image's crop"
  );
  await save();
  await db.exec("reset role");
  await db.query("delete from public.user_cards where user_id=$1", [owner]);
  await login(owner);
  assert.equal(
    (await details()).bannerUrl,
    url,
    "selling a card does not revoke a gallery banner"
  );
  await assert.rejects(save(null, frame, card), /BANNER_CARD_NOT_OWNED/);
  await assert.rejects(
    db.query("update public.user_profiles set banner_url=$1", [url]),
    /permission denied/
  );
  await assert.rejects(
    db.query("update public.user_profiles set banner_frame='{}'"),
    /permission denied/
  );
  await login(other);
  await assert.rejects(save(), /BANNER_URL_INVALID/);
  assert.equal(
    (await details()).bannerUrl,
    null,
    "another player cannot modify the owner's banner"
  );
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false); set role authenticated"
  );
  await assert.rejects(save(), /AUTH_REQUIRED/);
  await db.exec("set role anon");
  await assert.rejects(save(), /permission denied/);
  await db.exec("reset role");
  await db.query("select public.begin_account_deletion($1)", [owner]);
  await login(owner);
  await assert.rejects(save(), /ACCOUNT_DELETED/);
});
