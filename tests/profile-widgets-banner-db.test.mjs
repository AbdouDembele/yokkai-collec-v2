import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("profile widgets use real categories and banner saves remain owner-scoped and atomic", async t => {
  // Retain the complete historical upload contract on its last schema.
  // Owned-only banners have separate full-replay coverage in the product PR.
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
  const owner = "72000000-0000-4000-8000-000000000001";
  const other = "72000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [owner, "WidgetOwner"],
    [other, "WidgetOther"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  for (let i = 0; i < 13; i++)
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ($1,'Widget card',$2,'Widgets','C','https://example.test/card.png','test')",
      [`widget-${i}`, i === 0 ? "ANIME/MANGA" : `CATEGORY ${i}`]
    );
  // Previously free-text preferences now have to exist in the catalogue.
  for (const [index, name, category] of [
    [100, "Noragami", "ANIME/MANGA"],
    [101, "Black Butler", "ANIME/MANGA"],
    [102, "Other account", "CATEGORY 2"]
  ])
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ($1,'Widget card',$2,$3,'C','https://example.test/card.png','test')",
      [`widget-${index}`, category, name]
    );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  const save = value =>
    db.query("select public.update_profile_widgets($1::jsonb) value", [
      JSON.stringify(value)
    ]);
  const widgets = [
    { category: "ANIME/MANGA", entries: ["Noragami", "Black Butler"] },
    { category: "CATEGORY 2", entries: [] }
  ];
  assert.deepEqual((await save(widgets)).rows[0].value, widgets);
  for (const invalid of [
    null,
    {},
    [{}],
    [{ category: "NOT IN GAME", entries: [] }],
    [widgets[0], widgets[0]],
    [{ category: "ANIME/MANGA", entries: Array(13).fill("Too many") }],
    [{ category: "ANIME/MANGA", entries: ["x".repeat(101)] }],
    [{ category: "ANIME/MANGA", entries: [3] }],
    [{ ...widgets[0], user_id: other }],
    Array.from({ length: 13 }, (_, i) => ({
      category: i === 0 ? "ANIME/MANGA" : `CATEGORY ${i}`,
      entries: []
    }))
  ])
    await assert.rejects(save(invalid), /WIDGETS_INVALID/);
  const banner = `https://api.yokkai-collec.com/storage/v1/object/public/avatars/${owner}/banner.webp?v=123`;
  const appearance = (url, bio = "My profile") =>
    db.query(
      "select public.update_profile_appearance($1,null,'{}'::uuid[],null,$2) value",
      [bio, url]
    );
  assert.equal((await appearance(banner)).rows[0].value.bannerUrl, banner);
  const details = async id =>
    (await db.query("select public.get_profile_details($1) value", [id]))
      .rows[0].value;
  assert.deepEqual((await details(owner)).widgets, widgets);
  assert.ok(
    (await details(owner)).widgetCategories.includes("CATEGORY 12"),
    "new game categories automatically become widget choices"
  );
  for (const invalid of [
    banner.replace(owner, other),
    banner.replace("https:", "http:"),
    banner.replace("api.yokkai-collec.com", "evil.test"),
    banner.replace("banner.webp", "banner.svg"),
    banner.replace("banner.webp", "../banner.webp"),
    banner.replace("banner.webp", "%2e%2e/banner.webp"),
    banner + "#fragment",
    banner + "&extra=1",
    banner.replace("api.yokkai-collec.com", "api.yokkai-collec.com@evil.test"),
    banner + "x".repeat(2048)
  ])
    await assert.rejects(
      appearance(invalid, "Must not save"),
      /BANNER_URL_INVALID/
    );
  assert.equal(
    (await db.query("select public.get_profile(null) value")).rows[0].value.bio,
    "My profile"
  );
  await assert.rejects(appearance(banner, "x".repeat(301)), /BIO_TOO_LONG/);
  assert.equal((await details(owner)).bannerUrl, banner);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other
  ]);
  await save([{ category: "CATEGORY 2", entries: ["Other account"] }]);
  assert.deepEqual((await details(owner)).widgets, widgets);
  await assert.rejects(appearance(banner), /BANNER_URL_INVALID/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  assert.equal((await appearance(null)).rows[0].value.bannerUrl, null);
  assert.equal((await details(owner)).bannerUrl, null);
  await appearance(banner);
  await db.exec(
    "reset role; create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz); set role service_role"
  );
  const request = "72000000-0000-4000-8001-000000000001";
  await db.query("select public.reserve_data_export($1,$2)", [owner, request]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      owner,
      request
    ])
  ).rows[0].value;
  assert.deepEqual(exported.profile.profile_widgets, widgets);
  assert.equal(exported.profile.banner_url, banner.split("?")[0]);
  assert.ok(!JSON.stringify(exported).includes("Other account"));
  await db.exec("set role anon");
  await assert.rejects(save(widgets), /permission denied/);
  await assert.rejects(appearance(banner), /permission denied/);
});
