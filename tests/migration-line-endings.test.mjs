import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { deploymentPlan } from "../scripts/plan-deploy-migrations.mjs";
import { pgliteMigrationSource } from "../scripts/replay-migrations.mjs";

test("Windows and LF checkouts produce identical migration plans and preserve multiline SQL patches", async t => {
  const source = `begin;
create function public.eol_probe() returns text language sql as $body$
select 'first
second'::text;
$body$;
do $patch$
declare original text; changed text;
begin
  original := replace(pg_get_functiondef('public.eol_probe()'::regprocedure), chr(13), '');
  changed := replace(original, 'first
second', 'patched');
  if changed = original then raise exception 'PATCH_MISMATCH'; end if;
  execute changed;
end $patch$;
commit;`;
  const filename = "20260101000000_eol_probe.sql";
  const lf = deploymentPlan([{ filename, source }], []);
  const crlf = deploymentPlan(
    [{ filename, source: source.replaceAll("\n", "\r\n") }],
    []
  );
  assert.deepEqual(crlf, lf);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])"
  );
  await db.exec(crlf.sql);
  assert.equal(
    (await db.query("select public.eol_probe() as value")).rows[0].value,
    "patched"
  );
  assert.equal(
    (
      await db.query(
        "select statements[1] as source from supabase_migrations.schema_migrations"
      )
    ).rows[0].source,
    source
  );
});

test("managed pg_net is omitted only from disposable validation, retained in production SQL and registry", async t => {
  const source =
    "begin;\r\ncreate extension if not exists pg_net;\r\ncreate table public.extension_probe(id integer);\r\ncommit;";
  const filename = "20260101000000_extension_probe.sql";
  const production = deploymentPlan([{ filename, source }], []);
  assert.ok(production.sql.includes("create extension if not exists pg_net;"));
  assert.equal(
    production.sql.split("create extension if not exists pg_net;").length - 1,
    2
  );
  const validation = deploymentPlan(
    [{ filename, source: pgliteMigrationSource(source) }],
    []
  );
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])"
  );
  await db.exec(validation.sql);
  assert.equal(
    (await db.query("select to_regclass('public.extension_probe') as value"))
      .rows[0].value,
    "extension_probe"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from pg_extension where extname='pg_net'"
      )
    ).rows[0].count,
    0
  );
});
