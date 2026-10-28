import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { deploymentPlan } from "../scripts/plan-deploy-migrations.mjs";

test("approved migration transaction can write without changing the read-only default", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
    set default_transaction_read_only=on;
  `);
  const plan = deploymentPlan(
    [
      {
        filename: "20260101000000_readonly_probe.sql",
        source: "begin; create table public.readonly_probe(id integer); commit;"
      }
    ],
    []
  );
  await db.exec(plan.sql);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer as count from supabase_migrations.schema_migrations"
      )
    ).rows[0].count,
    1
  );
  assert.equal(
    (await db.query("show default_transaction_read_only")).rows[0]
      .default_transaction_read_only,
    "on"
  );
  assert.equal(
    (await db.query("show transaction_read_only")).rows[0]
      .transaction_read_only,
    "on"
  );
  await assert.rejects(
    db.exec("insert into public.readonly_probe values (1)"),
    { code: "25006" }
  );
});
