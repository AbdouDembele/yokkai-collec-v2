import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = "10000000-0000-4000-8000-000000000001";
const origin = "https://api.yokkai-collec.com";
const avatar = `${origin}/storage/v1/object/public/avatars/${player}/avatar.png?v=123`;
const migration = "20261009000007_validate_profile_avatar.sql";
// Preserve this historical URL-validation/migration-replay contract unchanged.
// Current Pro ownership and byte validation have dedicated full-replay tests.
const historicalReplay = () =>
  replayMigrations({
    migrations: readdirSync(new URL("../supabase/migrations/", import.meta.url))
      .filter(name => name.endsWith(".sql") && name < "20261018000001")
      .sort()
  });

test("authenticated update_profile accepts only bounded trusted avatar URLs", async t => {
  const { db } = await historicalReplay();
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"AvatarAlice"}\')',
    [player]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  const save = url =>
    db.query(
      "select public.update_profile('test',$1,'{}'::uuid[],null) as profile",
      [url]
    );
  assert.equal((await save(avatar)).rows[0].profile.avatarUrl, avatar);
  for (const url of [
    avatar.replace("https:", "http:"),
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "https://lh3.googleusercontent.com/avatar.png",
    "https://cdn.discordapp.com/avatars/a/b.png",
    avatar.replace(origin, `${origin}.evil.test`),
    avatar.replace("https://", "https://evil.test@"),
    avatar.replace("/avatars/", "/cards/"),
    avatar.replace("/avatars/", "/avatars/../cards/"),
    avatar.replace("/avatars/", "/avatars/%2e%2e/cards/"),
    avatar.replace("/avatars/", "/avatars%2f/"),
    avatar.replace("avatar.png", "avatar.svg"),
    `${avatar}#fragment`,
    `${avatar}&redirect=evil`,
    avatar.replace("avatar.png", "a".repeat(2048) + ".png")
  ])
    await assert.rejects(save(url), /AVATAR_URL_INVALID/, url);
  assert.equal(
    (await save(avatar)).rows[0].profile.avatarUrl,
    avatar,
    "rejections leave the avatar intact"
  );
  const prefix = `${origin}/storage/v1/object/public/avatars/`;
  const longest = prefix + "a".repeat(2048 - prefix.length - 4) + ".png";
  assert.equal((await save(longest)).rows[0].profile.avatarUrl.length, 2048);
  assert.equal((await save(null)).rows[0].profile.avatarUrl, null);
  assert.equal((await save("   ")).rows[0].profile.avatarUrl, null);
  await db.exec("reset role");
  for (const role of ["public", "anon"]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.update_profile(text,text,uuid[],uuid)','EXECUTE') as allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
  }
});

test("avatar migration preserves previously stored nonconforming avatars and is replayable", async t => {
  const { db } = await historicalReplay();
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"LegacyAvatar"}\')',
    [player]
  );
  const legacy = "https://legacy.example/avatar.png";
  await db.query(
    "update public.user_profiles set avatar_url=$1 where user_id=$2",
    [legacy, player]
  );
  await db.exec(
    readFileSync(
      new URL(`../supabase/migrations/${migration}`, import.meta.url),
      "utf8"
    )
  );
  assert.equal(
    (
      await db.query(
        "select avatar_url from public.user_profiles where user_id=$1",
        [player]
      )
    ).rows[0].avatar_url,
    legacy
  );
});
