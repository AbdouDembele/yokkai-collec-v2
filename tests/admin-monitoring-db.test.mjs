import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("monitor snapshots are readable only by administrators through admin_get_ops_monitor", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const admin = "ad900000-0000-4000-8000-000000000001";
  const player = "ad900000-0000-4000-8000-000000000002";
  for (const [i, id] of [admin, player].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2)",
      [id, JSON.stringify({ pseudo: `Monitor${i}` })]
    );
  await db.query("insert into public.admin_users(user_id)values($1)", [admin]);

  // Written by the host script as the table owner.
  const payload = (load5, connUsed) => ({
    v: 1,
    host: { load5, cpus: 8, memTotal: 100, memAvailable: 40 },
    db: { connUsed, connMax: 100 },
    issues: [{ key: "host.load", level: 1 }]
  });
  await db.query(
    "insert into public.ops_monitor_snapshots(captured_at,worst,payload)values(now()-interval '30 hours',0,$1),(now()-interval '10 minutes',0,$2),(now(),1,$3)",
    [payload(1, 10), payload(2, 20), payload(9, 30)]
  );

  const as = async (user, sql) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? ""
    ]);
    await db.exec(user ? "set role authenticated" : "set role anon");
    try {
      return (await db.query(sql)).rows;
    } finally {
      await db.exec("reset role");
    }
  };

  await assert.rejects(
    as(player, "select public.admin_get_ops_monitor(24) value"),
    /ADMIN_REQUIRED/
  );
  await assert.rejects(
    as(null, "select public.admin_get_ops_monitor(24) value"),
    /permission denied/
  );
  for (const user of [player, admin])
    await assert.rejects(
      as(user, "select * from public.ops_monitor_snapshots"),
      /permission denied/
    );
  await assert.rejects(
    as(
      player,
      "insert into public.ops_monitor_snapshots(worst,payload)values(0,'{}')"
    ),
    /permission denied/
  );

  const [{ value }] = await as(
    admin,
    "select public.admin_get_ops_monitor(24) value"
  );
  assert.ok(Number.isFinite(Date.parse(value.now)), "database clock");
  assert.equal(value.latest.worst, 1);
  assert.equal(value.latest.payload.host.load5, 9);
  assert.equal(value.history.length, 2, "only the last 24 hours");
  assert.deepEqual(
    value.history.map(point => point.connUsed),
    [20, 30]
  );
  assert.equal(value.history[1].cpus, 8);

  const [{ value: week }] = await as(
    admin,
    "select public.admin_get_ops_monitor(9999) value"
  );
  assert.equal(week.history.length, 3, "hours are clamped to 7 days");

  await assert.rejects(
    db.query(
      "insert into public.ops_monitor_snapshots(worst,payload)values(3,'{}')"
    ),
    /check/
  );
  await assert.rejects(
    db.query(
      "insert into public.ops_monitor_snapshots(worst,payload)values(0,'[]')"
    ),
    /check/
  );
});
