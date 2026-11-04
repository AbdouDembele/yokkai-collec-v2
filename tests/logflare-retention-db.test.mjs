import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync(
  new URL("../ops/logflare-retention.sql", import.meta.url),
  "utf8"
);
const script = readFileSync(
  new URL("../ops/yokkai-logflare-retention", import.meta.url),
  "utf8"
);

test("Logflare retention deletes only analytics events older than the configured days", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema _analytics;
    create table _analytics.log_events_auth (id uuid primary key default gen_random_uuid(), "timestamp" timestamp not null, body jsonb);
    create table _analytics.log_events_storage (id uuid primary key default gen_random_uuid(), "timestamp" timestamp not null, body jsonb);
    create table _analytics.sources (id bigint, "timestamp" timestamp);
    create table public.log_events_keep ("timestamp" timestamp);
  `);
  const utc = "(now() at time zone 'utc')";
  for (const table of ["log_events_auth", "log_events_storage"])
    await db.exec(`insert into _analytics.${table}("timestamp") values
      (${utc} - interval '40 days'), (${utc} - interval '8 days'),
      (${utc} - interval '6 days'), (${utc} - interval '1 hour')`);
  await db.exec(`insert into _analytics.sources values (1, ${utc} - interval '40 days');
    insert into public.log_events_keep values (${utc} - interval '40 days');`);
  const count = async relation =>
    Number((await db.query(`select count(*) n from ${relation}`)).rows[0].n);

  // Default: 7 days.
  await db.exec(sql);
  assert.equal(await count("_analytics.log_events_auth"), 2);
  assert.equal(await count("_analytics.log_events_storage"), 2);
  assert.equal(await count("_analytics.sources"), 1, "only log_events tables");
  assert.equal(await count("public.log_events_keep"), 1, "only _analytics");

  // Configured duration, as passed by the script through PGOPTIONS.
  await db.exec("set yokkai.retention_days = '1'");
  await db.exec(sql);
  assert.equal(await count("_analytics.log_events_auth"), 1);

  for (const days of ["0", "91"]) {
    await db.exec(`set yokkai.retention_days = '${days}'`);
    await assert.rejects(() => db.exec(sql), /INVALID_RETENTION_DAYS/);
  }
  assert.equal(await count("_analytics.log_events_auth"), 1);
});

test("the retention script only deletes rows and targets the analytics database", () => {
  assert.doesNotMatch(sql, /\b(truncate|drop)\b/i);
  assert.match(script, /-d _supabase/);
  assert.match(script, /yokkai\.retention_days=\$RETENTION_DAYS/);
  assert.match(script, /RETENTION_DAYS="\$\{RETENTION_DAYS:-7\}"/);
});
