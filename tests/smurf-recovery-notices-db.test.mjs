import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const migration = "20261103010000_smurf_recovery_notices.sql";
test("withdrawal notices backfill exact receipts, publish all three paths atomically and stay private until own acknowledgement", async t => {
  const files = fs
    .readdirSync("supabase/migrations")
    .filter(f => f.endsWith(".sql") && f < migration)
    .sort();
  const { db } = await replayMigrations({ migrations: files });
  t.after(() => db.close());
  const [smurf, primary, other] = [1, 2, 3].map(
    n => `ac670000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  for (const [id, pseudo] of [
    [smurf, "Source"],
    [primary, "Main"],
    [other, "Other"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  const active = async (cards, karas) =>
    (
      await db.query(
        `insert into public.anticheat_smurf_sanctions(smurf_user_id,primary_user_id,accepted_trade_ids,recovered_card_ids,recovered_karas,recovered_trade_karas,note,evidence,history,recovery_snapshot)values($1,$2,'{}',$3,$4,$4,'Verified fixture decision','{}','{"trades":[],"sales":[]}','{}')returning id`,
        [smurf, primary, cards, karas]
      )
    ).rows[0].id;
  const copy = "ac670000-0000-4000-8000-000000000004";
  const receipt = await active([copy], 2200);
  await db.exec(fs.readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    primary
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select * from public.get_my_pending_sanctions()")).rows
      .length,
    0
  );
  await db.exec("reset role");
  await db.query("select set_config('request.headers',$1,false)", [
    JSON.stringify({ "x-client-info": "yokkai-assets-notice-v1" })
  ]);
  const get = async user => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return (await db.query("select * from public.get_my_pending_sanctions()"))
        .rows;
    } finally {
      await db.exec("reset role");
    }
  };
  const rows = await get(primary);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sanction_type, "SMURF_ASSET_RECOVERY");
  assert.equal(rows[0].cards_removed, 1);
  assert.equal(rows[0].kara_removed, 2200);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "applied_at",
    "cards_removed",
    "kara_removed",
    "sanction_id",
    "sanction_type"
  ]);
  assert.equal((await get(smurf)).length, 0);
  assert.equal((await get(other)).length, 0);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const access = (
      await db.query(
        "select has_table_privilege($1,'public.anticheat_asset_recovery_notices','SELECT')r,has_table_privilege($1,'public.anticheat_asset_recovery_notices','UPDATE')u,has_function_privilege($1,'public.anticheat_publish_asset_recovery_notice()','EXECUTE')e",
        [role]
      )
    ).rows[0];
    assert.deepEqual(access, { r: false, u: false, e: false });
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (
      await db.query("select public.acknowledge_my_sanction($1)ok", [
        rows[0].sanction_id
      ])
    ).rows[0].ok,
    false
  );
  await assert.rejects(
    db.exec("select * from public.anticheat_asset_recovery_notices"),
    /permission denied/
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    primary
  ]);
  await db.exec("set role authenticated");
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await db.query("select public.acknowledge_my_sanction($1)ok", [
          rows[0].sanction_id
        ])
      ).rows[0].ok,
      true
    );
  await db.exec("reset role");
  const seen = (
    await db.query(
      "select notification_seen_at from public.anticheat_asset_recovery_notices where receipt_id=$1",
      [receipt]
    )
  ).rows[0].notification_seen_at;
  assert.ok(seen);
  assert.equal((await get(primary)).length, 0);
  const deleted = async () =>
    await db.query(
      `insert into public.anticheat_deleted_smurf_recoveries(primary_user_id,source_trade_ids,recovered_card_ids,recovered_karas,note,evidence_reference,history,recovery_snapshot)values($1,$2,'{}',75,'Verified deleted source','Independent evidence','{"trades":[],"sales":[]}','{}')`,
      [primary, [copy]]
    );
  await db.exec("begin");
  await deleted();
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anticheat_asset_recovery_notices"
      )
    ).rows[0].n,
    2
  );
  await db.exec("rollback");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anticheat_asset_recovery_notices"
      )
    ).rows[0].n,
    1
  );
  await deleted();
  await db.query(
    `insert into public.anticheat_deleted_account_sanctions(primary_user_id,deleted_user_ids,note,history,recovery,preparation)values($1,$2,'Verified multiple sources','{}','{"cards":2,"karas":150}','{}')`,
    [primary, [smurf]]
  );
  const pending = await get(primary);
  assert.deepEqual(
    pending.map(p => [p.cards_removed, p.kara_removed]),
    [
      [0, 75],
      [2, 150]
    ]
  );
  // No false withdrawal notice for a zero-asset decision.
  await db.query(
    `insert into public.anticheat_deleted_account_sanctions(primary_user_id,deleted_user_ids,note,history,recovery,preparation)values($1,$2,'Banning only fixture','{}','{"cards":0,"karas":0}','{}')`,
    [primary, [smurf]]
  );
  assert.equal((await get(primary)).length, 2);
});
