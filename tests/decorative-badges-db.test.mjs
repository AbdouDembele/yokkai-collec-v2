import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("the full badge catalogue can be saved by Pro owners while the three-badge limit remains enforced", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const source = readFileSync("lib/ui/profile-style.ts", "utf8")
    .split("export const STYLE_BADGES = [")[1]
    .split("] as const;")[0];
  const badges = [...source.matchAll(/id: "([a-z]+)"/g)].map(match => match[1]);
  assert.equal(badges.length, 14);
  const user = "86200000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [user, JSON.stringify({ pseudo: "BadgeOwner" })]
  );
  const save = style =>
    db.query(
      "insert into public.profile_customizations(user_id,style) values($1,$2) returning style",
      [user, JSON.stringify(style)]
    );
  await assert.rejects(save({ badges: ["crown"] }), /PRO_REQUIRED/);
  await db.query(
    "select public.billing_set_manual_pro_access($1,true,'Disposable badge test')",
    [user]
  );
  for (const badge of badges) {
    const result = await save({ badges: [badge] });
    assert.deepEqual(result.rows[0].style.badges, [badge]);
    await db.query(
      "delete from public.profile_customizations where user_id=$1",
      [user]
    );
  }
  for (const invalid of [
    ["crown", "bolt", "heart", "cat"],
    ["crown", "crown"],
    ["unknown"]
  ])
    await assert.rejects(save({ badges: invalid }), /PROFILE_STYLE_INVALID/);
  await save({ badges: ["crown", "cat", "butterfly"] });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  const profile = (await db.query("select public.get_profile(null) value"))
    .rows[0].value;
  assert.deepEqual(profile.profileStyle.style.badges, [
    "crown",
    "cat",
    "butterfly"
  ]);
  await assert.rejects(
    db.query("update public.profile_customizations set style='{}'"),
    /permission denied/
  );
});
