import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261009000006_cron_history_retention.sql";
const sql = () =>
  readFileSync(
    new URL(`../supabase/migrations/${migration}`, import.meta.url),
    "utf8"
  );
const command =
  "delete from cron.job_run_details where end_time < now() - interval '7 days';";

test("cron declares an idempotent daily seven-day history purge as postgres", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const jobs = async () =>
    (
      await db.query(
        "select jobname,schedule,command,username,database,active from cron.job where jobname='purge-cron-history'"
      )
    ).rows;
  const expected = [
    {
      jobname: "purge-cron-history",
      schedule: "0 3 * * *",
      command,
      username: "postgres",
      database: "postgres",
      active: true
    }
  ];
  assert.deepEqual(await jobs(), expected);
  await db.exec(sql());
  assert.deepEqual(await jobs(), expected);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from cron.job where jobname='settle-expired-auctions'"
      )
    ).rows[0].n,
    1
  );
});

test("the registered postgres command deletes only completed runs older than seven days", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // Fix now() for the exact boundary. PGlite records jobs but never runs a scheduler.
  await db.exec("begin; set local role postgres");
  await db.query("select set_config('request.jwt.claim.sub','',true)");
  assert.deepEqual(
    (await db.query("select current_user as role,auth.uid() as uid")).rows,
    [{ role: "postgres", uid: null }]
  );
  await db.exec(`insert into cron.job_run_details(start_time,end_time) values
    (now()-interval '8 days',now()-interval '8 days'),
    (now()-interval '30 days',now()-interval '30 days'),
    (now()-interval '6 days',now()-interval '6 days'),
    (now()-interval '7 days',now()-interval '7 days'),
    (now()-interval '30 days',null)`);
  const rows = async () =>
    (await db.query("select runid from cron.job_run_details order by runid"))
      .rows;
  const before = await rows();
  const registered = (
    await db.query(
      "select command from cron.job where jobname='purge-cron-history'"
    )
  ).rows[0].command;
  assert.equal(registered, command);
  await db.exec(registered);
  assert.deepEqual(await rows(), before.slice(2));
  await db.exec(registered);
  assert.deepEqual(await rows(), before.slice(2));
  await db.exec("commit");
});

test("missing cron history fails explicitly without leaving a purge job", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "delete from cron.job where jobname='purge-cron-history'; drop table cron.job_run_details"
  );
  await assert.rejects(db.exec(sql()), /PG_CRON_HISTORY_REQUIRED/);
  await db.exec("rollback");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from cron.job where jobname='purge-cron-history'"
      )
    ).rows[0].n,
    0
  );
});
