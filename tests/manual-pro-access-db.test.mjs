import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const owner = "71000000-0000-4000-8000-000000000001";
const other = "71000000-0000-4000-8000-000000000002";

test("manual Pro grants are server-only, targeted, auditable and fully revocable", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [owner, "ManualPro"],
    [other, "StillBasic"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );

  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner
  ]);
  for (const sql of [
    "select * from public.pro_access_grants",
    `select public.billing_set_manual_pro_access('${owner}',true,'Browser grant')`,
    `select public.billing_has_game_pro('${owner}')`
  ])
    await assert.rejects(db.query(sql), /permission denied/);

  await db.exec("reset role;set role service_role");
  await assert.rejects(
    db.query("select public.billing_set_manual_pro_access($1,true,$2)", [
      owner,
      "x"
    ]),
    /PRO_GRANT_INVALID/
  );
  await db.query("select public.billing_set_manual_pro_access($1,true,$2)", [
    owner,
    "Staff testing and public Pro showcase"
  ]);
  assert.equal(
    (await db.query("select public.billing_has_game_pro($1) value", [owner]))
      .rows[0].value,
    true
  );
  assert.equal(
    (await db.query("select public.billing_has_game_pro($1) value", [other]))
      .rows[0].value,
    false
  );
  const grant = (
    await db.query(
      "select reason,expires_at,created_at,updated_at from public.pro_access_grants where user_id=$1",
      [owner]
    )
  ).rows[0];
  assert.equal(grant.reason, "Staff testing and public Pro showcase");
  assert.equal(grant.expires_at, null);
  assert.ok(grant.created_at);
  assert.ok(grant.updated_at);
  const timing = (
    await db.query(
      "select regular_pack_interval_seconds regular,decision_pack_interval_seconds decision from public.user_profiles where user_id=$1",
      [owner]
    )
  ).rows[0];
  assert.equal(timing.regular, 300);
  assert.equal(timing.decision, 43200);

  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other
  ]);
  const profile = (
    await db.query("select public.get_profile($1) value", ["ManualPro"])
  ).rows[0].value;
  assert.equal(profile.isPro, true, "other players see the public Pro badge");

  await db.exec("reset role;set role service_role");
  await db.query("select public.billing_set_manual_pro_access($1,false)", [
    owner
  ]);
  assert.equal(
    (await db.query("select public.billing_has_game_pro($1) value", [owner]))
      .rows[0].value,
    false
  );
  const downgraded = (
    await db.query(
      "select regular_pack_interval_seconds regular,decision_pack_interval_seconds decision from public.user_profiles where user_id=$1",
      [owner]
    )
  ).rows[0];
  assert.equal(downgraded.regular, 600);
  assert.equal(downgraded.decision, 86400);
});
