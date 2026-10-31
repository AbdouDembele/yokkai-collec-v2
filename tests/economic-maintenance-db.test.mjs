import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("economic maintenance: private operator context, closed mutation gate and available reads", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  assert.deepEqual(
    (await db.query("select active from public.economic_maintenance_state"))
      .rows,
    [{ active: false }]
  );
  assert.equal(
    (
      await db.query(
        "select prosecdef from pg_proc where oid='public.guard_economic_maintenance()'::regprocedure"
      )
    ).rows[0].prosecdef,
    false
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.guard_economic_maintenance()','EXECUTE') ok",
          [role]
        )
      ).rows[0].ok,
      false
    );
    await db.exec(`set role ${role}`);
    assert.deepEqual(
      (await db.query("select active from public.economic_maintenance_state"))
        .rows,
      [{ active: false }]
    );
    await assert.rejects(
      db.exec("select operator from public.economic_maintenance_state"),
      /permission denied/
    );
    await assert.rejects(
      db.exec("update public.economic_maintenance_state set active=false"),
      /permission denied/
    );
    await db.exec("reset role");
  }
  const who = "73000000-0000-4000-8000-000000000001";
  await db.query("insert into auth.users(id,raw_user_meta_data)values($1,$2)", [
    who,
    { pseudo: "MaintenanceFixture" }
  ]);
  await db.exec("update public.economic_maintenance_state set active=true");
  for (const sql of [
    `update public.user_profiles set karas_balance=karas_balance+1 where user_id='${who}'`,
    "delete from public.user_cards where false",
    "update public.auctions set current_price=current_price where false",
    "delete from public.bids where false",
    "delete from public.trade_offers where false",
    "delete from public.decision_packs where false",
    "delete from public.decision_pack_choices where false"
  ])
    await assert.rejects(db.exec(sql), /ECONOMIC_MAINTENANCE/);
  await db.query(
    "update public.user_profiles set presence_active=true where user_id=$1",
    [who]
  );
  assert.equal(
    (
      await db.query(
        "select presence_active from public.user_profiles where user_id=$1",
        [who]
      )
    ).rows[0].presence_active,
    true
  );
  await db.exec("update public.economic_maintenance_state set active=false");
  await db.query(
    "update public.user_profiles set karas_balance=karas_balance+1 where user_id=$1",
    [who]
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [who]
      )
    ).rows[0].karas_balance,
    1
  );
});
