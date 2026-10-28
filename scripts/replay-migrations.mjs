import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// Shared Supabase bootstrap for disposable PGlite and PostgreSQL databases.
export const bootstrapSQL = `
      create schema auth;
      create table auth.users(
        id uuid primary key,
        raw_user_meta_data jsonb,
        raw_app_meta_data jsonb,
        email_confirmed_at timestamptz
      );
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(bucket_id text, name text, owner_id text);
      create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
      grant usage on schema public, auth, storage to anon, authenticated, service_role;
      -- Record cron declarations only; never run scheduled jobs in disposable tests.
      create schema cron;
      create table cron.job (
        jobid bigint generated always as identity primary key,
        jobname text not null, schedule text not null, command text not null,
        username text not null default current_user, database text not null default current_database(),
        active boolean not null default true, unique(jobname, username)
      );
      create table cron.job_run_details (
        runid bigint generated always as identity primary key,
        start_time timestamptz, end_time timestamptz
      );
      create function cron.schedule(job_name text, schedule text, command text)
      returns bigint language sql as $$
        insert into cron.job(jobname,schedule,command) values ($1,$2,$3)
        on conflict(jobname,username) do update set schedule=excluded.schedule, command=excluded.command, active=true
        returning jobid
      $$;
      revoke all on function cron.schedule(text,text,text) from public;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    `;

// A cold PGlite start runs initdb (~2 s); each drift check is a new process, so
// keep the empty initialized cluster per PGlite version and load it instead.
// Only the empty cluster is cached: bootstrap and migrations always replay.
// YOKKAI_PGLITE_CACHE=off neither reads nor writes it (default for --apply).
const pgliteVersion = JSON.parse(
  readFileSync(
    new URL(
      "../node_modules/@electric-sql/pglite/package.json",
      import.meta.url
    ),
    "utf8"
  )
).version;
const emptyCluster = new URL(
  `../node_modules/.cache/yokkai-pglite/empty-${pgliteVersion}.tar`,
  import.meta.url
);
async function freshDatabase() {
  const options = { extensions: { pg_trgm } };
  if (process.env.YOKKAI_PGLITE_CACHE === "off") return PGlite.create(options);
  try {
    return await PGlite.create({
      ...options,
      loadDataDir: new Blob([readFileSync(emptyCluster)])
    });
  } catch {}
  const db = await PGlite.create(options);
  try {
    const archive = await db.dumpDataDir("none");
    mkdirSync(new URL(".", emptyCluster), { recursive: true });
    // Unique name then rename: concurrent processes never read a partial file.
    const partial = `${fileURLToPath(emptyCluster)}.${process.pid}.partial`;
    writeFileSync(partial, Buffer.from(await archive.arrayBuffer()));
    renameSync(partial, emptyCluster);
  } catch {}
  return db;
}

// Disposable database only: mimic Supabase defaults before creating application objects.
export async function replayMigrations({ migrations: selected } = {}) {
  const db = await freshDatabase();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
${bootstrapSQL}`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    const available = readdirSync(directory)
      .filter(name => name.endsWith(".sql"))
      .sort();
    const migrations = selected ?? available;
    if (
      !Array.isArray(migrations) ||
      migrations.some(name => !available.includes(name))
    ) {
      throw new Error("Invalid migration selection");
    }
    for (const name of migrations) {
      try {
        await db.exec(readFileSync(new URL(name, directory), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${name}: ${error.message}`, {
          cause: error
        });
      }
    }
    return { db, migrations };
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function securityDefinerAccess(db) {
  return (
    await db.query(`
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as signature,
      r.role, has_function_privilege(r.role, p.oid, 'EXECUTE') as executable
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join (values ('anon'), ('authenticated')) r(role)
    where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
    order by signature, r.role
  `)
  ).rows;
}
