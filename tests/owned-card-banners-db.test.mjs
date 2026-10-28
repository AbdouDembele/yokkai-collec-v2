import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("all profile entry points require an owned banner card, reject uploads and keep atomic crop/privacy rights", async t => {
  // Preserve the entire original owned-only contract as history. The restored
  // gallery policy is checked separately against the complete migration replay.
  const migrations = readdirSync(
    new URL("../supabase/migrations/", import.meta.url)
  )
    .filter(
      name =>
        name.endsWith(".sql") && name <= "20261016000001_owned_card_banners.sql"
    )
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  const owner = "79000000-0000-4000-8000-000000000001";
  const other = "79000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "OwnedBanner"],
    [other, "OtherBanner"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  const cards = [];
  for (const [name, rarity] of [
    ["Owned", "SSR"],
    ["Other", "LR"],
    ["Wishlist", "C"]
  ]) {
    cards.push(
      (
        await db.query(
          "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ($1,$1,'ANIME/MANGA','Banner ownership',$2,'https://example.test/card.png','test') returning id",
          [`owned-banner-${name}`, rarity]
        )
      ).rows[0].id
    );
  }
  const copies = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SSR'),($1,$2,'SSR'),($3,$4,'LR') returning id",
      [owner, cards[0], other, cards[1]]
    )
  ).rows.map(row => row.id);
  await db.query(
    "insert into public.wishlists(user_id,card_id) values ($1,$2)",
    [owner, cards[2]]
  );
  const login = async id => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const frame = { x: 30, y: 65, zoom: 1.2, rotation: 90 };
  const save = async (
    method,
    card = cards[0],
    {
      url = null,
      bio = "Owned banner",
      crop = frame,
      avatar = null,
      featured = []
    } = {}
  ) => {
    const args = [bio, avatar, featured, card];
    if (method !== "update_profile") args.push(url);
    if (method === "update_profile_appearance_framed")
      args.push(JSON.stringify(crop));
    return (
      await db.query(
        `select public.${method}(${args.map((_, i) => `$${i + 1}${i === 2 ? "::uuid[]" : i === 5 ? "::jsonb" : ""}`).join(",")}) value`,
        args
      )
    ).rows[0].value;
  };
  const details = async () =>
    (await db.query("select public.get_profile_details(null) value")).rows[0]
      .value;
  const profile = async () =>
    (await db.query("select public.get_profile(null) value")).rows[0].value;
  await login(owner);
  for (const method of [
    "update_profile",
    "update_profile_appearance",
    "update_profile_appearance_framed"
  ]) {
    assert.equal((await save(method)).bannerCard.id, cards[0], method);
    for (const id of [
      cards[1],
      cards[2],
      "79000000-0000-4000-8000-000000000099"
    ])
      await assert.rejects(
        save(method, id, { bio: "Must not persist" }),
        /BANNER_CARD_NOT_OWNED/
      );
    assert.equal((await profile()).bio, "Owned banner");
  }
  for (const method of [
    "update_profile_appearance",
    "update_profile_appearance_framed"
  ])
    for (const url of [
      `https://api.yokkai-collec.com/storage/v1/object/public/avatars/${owner}/banner.gif?v=123`,
      `https://api.yokkai-collec.com/storage/v1/object/public/avatars/${owner}/avatar.png`,
      "https://example.test/card.png",
      "data:image/png;base64,AA",
      "javascript:alert(1)"
    ])
      await assert.rejects(
        save(method, cards[0], { url }),
        /BANNER_URL_DISABLED/
      );
  assert.deepEqual((await details()).bannerFrame, frame);
  assert.equal((await details()).bannerUrl, null);
  await assert.rejects(
    save("update_profile_appearance_framed", cards[0], {
      crop: { ...frame, rotation: 45 }
    }),
    /BANNER_FRAME_INVALID/
  );
  await assert.rejects(
    save("update_profile_appearance_framed", cards[0], {
      bio: "x".repeat(301)
    }),
    /BIO_TOO_LONG/
  );
  await assert.rejects(
    save("update_profile_appearance_framed", cards[0], {
      avatar: "http://evil.test/a.png"
    }),
    /AVATAR_URL_INVALID/
  );
  await assert.rejects(
    save("update_profile_appearance_framed", cards[0], {
      featured: [copies[2]]
    }),
    /CARD_NOT_OWNED/
  );
  assert.equal((await profile()).bio, "Owned banner");
  assert.deepEqual(
    (await details()).bannerFrame,
    frame,
    "rejected updates roll back the whole appearance"
  );
  for (const role of ["public", "anon", "authenticated"])
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.clear_unowned_profile_banner()','EXECUTE') allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
  await assert.rejects(
    db.query("select public.clear_unowned_profile_banner()"),
    /permission denied/
  );
  await assert.rejects(
    db.query("update public.user_profiles set banner_card_id=$1", [cards[1]]),
    /permission denied/
  );
  await login(other);
  await assert.rejects(
    save("update_profile_appearance_framed"),
    /BANNER_CARD_NOT_OWNED/
  );
  assert.equal(
    (await save("update_profile_appearance_framed", cards[1])).bannerCard.id,
    cards[1]
  );
  await db.exec("reset role");
  await db.query("delete from public.user_cards where id=$1", [copies[0]]);
  await login(owner);
  assert.equal(
    (await profile()).bannerCard.id,
    cards[0],
    "removing a duplicate preserves the banner"
  );
  assert.deepEqual((await details()).bannerFrame, frame);
  await db.exec("reset role");
  await db.query("update public.user_cards set user_id=$1 where id=$2", [
    other,
    copies[1]
  ]);
  await login(owner);
  assert.equal(
    (await profile()).bannerCard,
    null,
    "transferring the last copy revokes the banner"
  );
  assert.equal((await details()).bannerFrame, null);
  await assert.rejects(
    save("update_profile_appearance_framed"),
    /BANNER_CARD_NOT_OWNED/,
    "a stale collection cannot restore a sold banner"
  );
  await login(other);
  assert.equal(
    (await profile()).bannerCard.id,
    cards[1],
    "another player's banner is unaffected"
  );
  await save("update_profile_appearance_framed", cards[0]);
  await db.exec("reset role");
  await db.exec("begin");
  await db.query("delete from public.user_cards where id=$1", [copies[1]]);
  const replacement = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity,is_shiny) values ($1,$2,'SSR',true) returning id",
      [other, cards[0]]
    )
  ).rows[0].id;
  await db.exec("commit");
  await login(other);
  assert.equal(
    (await profile()).bannerCard.id,
    cards[0],
    "an evolution replacing copies in one transaction preserves the banner"
  );
  assert.deepEqual((await details()).bannerFrame, frame);
  await db.exec("reset role");
  await db.query("delete from public.user_cards where id=$1", [replacement]);
  await login(other);
  assert.equal(
    (await profile()).bannerCard,
    null,
    "destroying the last copy also revokes the banner"
  );
  await save("update_profile_appearance_framed", cards[1]);
  await save("update_profile", null);
  assert.equal(
    (await details()).bannerFrame,
    null,
    "legacy remove clears framing too"
  );
  await save("update_profile_appearance_framed", cards[1]);
  await db.exec(
    "reset role; create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz); set role service_role"
  );
  const request = "79000000-0000-4000-8001-000000000001";
  await db.query("select public.reserve_data_export($1,$2)", [other, request]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      other,
      request
    ])
  ).rows[0].value;
  assert.equal(exported.profile.banner_card_id, cards[1]);
  assert.deepEqual(exported.profile.banner_frame, frame);
  await db.exec("reset role");
  await db.query("select public.begin_account_deletion($1)", [other]);
  await login(other);
  await assert.rejects(save("update_profile", cards[1]), /ACCOUNT_DELETED/);
  await db.exec("set role anon");
  await assert.rejects(save("update_profile", cards[1]), /permission denied/);
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false); set role authenticated"
  );
  await assert.rejects(save("update_profile", cards[1]), /AUTH_REQUIRED/);
});
