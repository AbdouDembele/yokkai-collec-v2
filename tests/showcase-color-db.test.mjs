import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("showcase colors are validated, Pro-only and preserved in the owner's cosmetic projection", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = "86300000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [user, JSON.stringify({ pseudo: "ShowcaseColor" })]
  );
  const save = style =>
    db.query(
      "insert into public.profile_customizations(user_id,style) values($1,$2)",
      [user, JSON.stringify(style)]
    );
  await assert.rejects(save({ showcaseColor: "#ff4d9d" }), /PRO_REQUIRED/);
  await db.query(
    "select public.billing_set_manual_pro_access($1,true,'Disposable showcase color test')",
    [user]
  );
  for (const showcaseColor of [
    "#abc",
    "#12345g",
    "url(javascript:bad)",
    12,
    null,
    ["#ff4d9d"]
  ])
    await assert.rejects(save({ showcaseColor }), /PROFILE_STYLE_INVALID/);
  await save({
    color: "#eeebff",
    secondary: "#b69aff",
    showcaseColor: "#ff4d9d",
    showcaseEffect: "glow"
  });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  const profile = (await db.query("select public.get_profile(null) value"))
    .rows[0].value;
  assert.equal(profile.profileStyle.style.showcaseColor, "#ff4d9d");
  assert.equal(profile.profileStyle.style.color, "#eeebff");
  await assert.rejects(
    db.query("update public.profile_customizations set style='{}'"),
    /permission denied/
  );
  await db.exec("reset role");
  await db.query("delete from public.pro_access_grants where user_id=$1", [
    user
  ]);
  const inactive = (await db.query("select public.get_profile(null) value"))
    .rows[0].value;
  assert.equal(inactive.profileStyle.active, false);
  assert.deepEqual(inactive.profileStyle.style, {});
});
