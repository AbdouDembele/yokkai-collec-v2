import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("name effect catalog remains Pro-only and projects every saved effect", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = "86600000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [user, JSON.stringify({ pseudo: "EffectOwner" })]
  );
  const save = effect =>
    db.query(
      "insert into public.profile_customizations(user_id,style) values($1,$2)",
      [user, JSON.stringify({ effect })]
    );
  await assert.rejects(save("aurora"), /PRO_REQUIRED/);
  await db.query(
    "select public.billing_set_manual_pro_access($1,true,'Disposable name effect test')",
    [user]
  );
  for (const effect of [
    "solid",
    "gradient",
    "neon",
    "outline",
    "pop",
    "shimmer",
    "prism",
    "aurora",
    "chrome",
    "fire",
    "frost",
    "hologram",
    "glitch",
    "pulse"
  ]) {
    await save(effect);
    const result = (
      await db.query("select public.billing_profile_cosmetics($1) value", [
        user
      ])
    ).rows[0].value;
    assert.equal(result.style.effect, effect);
    await db.query(
      "delete from public.profile_customizations where user_id=$1",
      [user]
    );
  }
  for (const invalid of ["unknown", "url(bad)", null, ["aurora"]])
    await assert.rejects(save(invalid), /PROFILE_STYLE_INVALID/);
});
