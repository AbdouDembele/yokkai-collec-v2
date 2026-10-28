import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("profile font catalog saves for Pro owners and rejects unknown values", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = "86500000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [user, JSON.stringify({ pseudo: "FontOwner" })]
  );
  const save = font =>
    db.query(
      "insert into public.profile_customizations(user_id,style) values($1,$2)",
      [user, JSON.stringify({ font })]
    );
  await assert.rejects(save("arcade"), /PRO_REQUIRED/);
  await db.query(
    "select public.billing_set_manual_pro_access($1,true,'Disposable font catalog test')",
    [user]
  );
  for (const font of [
    "modern",
    "classic",
    "rounded",
    "mono",
    "bold",
    "editorial",
    "script",
    "display",
    "arcade",
    "comic",
    "gothic",
    "signature",
    "retro",
    "tech",
    "condensed",
    "stencil"
  ]) {
    await save(font);
    const result = (
      await db.query("select public.billing_profile_cosmetics($1) value", [
        user
      ])
    ).rows[0].value;
    assert.equal(result.style.font, font);
    await db.query(
      "delete from public.profile_customizations where user_id=$1",
      [user]
    );
  }
  for (const value of ["unknown", "url(bad)", null, ["arcade"]])
    await assert.rejects(save(value), /PROFILE_STYLE_INVALID/);
});
