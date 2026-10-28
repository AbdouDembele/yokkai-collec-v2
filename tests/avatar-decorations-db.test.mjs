import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("decorative avatar contours remain Pro-only and survive the profile projection", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = "86400000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [user, JSON.stringify({ pseudo: "FrameOwner" })]
  );
  const save = avatarFrame =>
    db.query(
      "insert into public.profile_customizations(user_id,style) values($1,$2)",
      [user, JSON.stringify({ avatarFrame })]
    );
  await assert.rejects(save("cat"), /PRO_REQUIRED/);
  await db.query(
    "select public.billing_set_manual_pro_access($1,true,'Disposable avatar decoration test')",
    [user]
  );
  for (const frame of [
    "none",
    "orbit",
    "crystal",
    "bloom",
    "flame",
    "cat",
    "royal",
    "sakura",
    "wings",
    "electric",
    "laurel",
    "fox",
    "roses",
    "lunar",
    "dragon",
    "ocean",
    "pixel",
    "bloodmoon",
    "shadow",
    "rage"
  ]) {
    await save(frame);
    const result = (
      await db.query("select public.billing_profile_cosmetics($1) value", [
        user
      ])
    ).rows[0].value;
    assert.equal(result.style.avatarFrame, frame);
    await db.query(
      "delete from public.profile_customizations where user_id=$1",
      [user]
    );
  }
  for (const invalid of ["unknown", "url(bad)", null, ["cat"]])
    await assert.rejects(save(invalid), /PROFILE_STYLE_INVALID/);
});
