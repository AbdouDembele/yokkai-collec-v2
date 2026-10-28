import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { replayMigrations } from "./replay-migrations.mjs";

const registryExceptions = JSON.parse(
  readFileSync(
    new URL("../supabase/migration-registry-exceptions.json", import.meta.url),
    "utf8"
  )
);

// Split top-level SQL only: PL/pgSQL bodies, quoted text and comments retain
// their semicolons. Never let a migration COMMIT the deployment transaction.
export function transactionBody(source, filename) {
  const statements = [];
  let start = 0,
    head = "";
  for (let i = 0; i < source.length;) {
    const rest = source.slice(i);
    if (rest.startsWith("--")) {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end + 1;
      head += " ";
      continue;
    }
    if (rest.startsWith("/*")) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (source.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw new Error(`${filename}: unclosed SQL comment`);
      head += " ";
      continue;
    }
    const dollar = rest.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (dollar) {
      const end = source.indexOf(dollar, i + dollar.length);
      if (end === -1) throw new Error(`${filename}: unclosed dollar quote`);
      i = end + dollar.length;
      head += " literal ";
      continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i++];
      const escape = quote === "'" && /\bE$/i.test(head);
      let closed = false;
      while (i < source.length) {
        if (escape && source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i++] === quote) {
          if (source[i] === quote) {
            i++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error(`${filename}: unclosed SQL quote`);
      head += " literal ";
      continue;
    }
    if (source[i] === "\\")
      throw new Error(`${filename}: psql commands are forbidden`);
    if (source[i] === ";") {
      if (head.trim())
        statements.push({
          sql: source.slice(start, i + 1),
          head: head.trim().replace(/\s+/g, " ").toUpperCase()
        });
      start = ++i;
      head = "";
    } else head += source[i++];
  }
  if (head.trim()) throw new Error(`${filename}: missing final semicolon`);
  if (statements[0]?.head === "BEGIN" && statements.at(-1)?.head === "COMMIT") {
    statements.shift();
    statements.pop();
  }
  for (const { head } of statements) {
    if (
      /^(BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE TRANSACTION|SET TRANSACTION)\b/.test(
        head
      )
    ) {
      throw new Error(
        `${filename}: transaction control is forbidden inside the deployment`
      );
    }
    if (
      /^(VACUUM|ALTER SYSTEM|DISCARD ALL|(?:CREATE|DROP) (?:DATABASE|TABLESPACE)|CREATE (?:UNIQUE )?INDEX CONCURRENTLY|DROP INDEX CONCURRENTLY|REINDEX\b.*\bCONCURRENTLY|REINDEX (?:DATABASE|SYSTEM|SCHEMA))\b/.test(
        head
      )
    ) {
      throw new Error(
        `${filename}: instruction incompatible with a single transaction: ${head.split(" ").slice(0, 5).join(" ")}`
      );
    }
  }
  return statements.map(s => s.sql).join("\n");
}

export function deploymentPlan(files, registry) {
  if (!Array.isArray(registry))
    throw new Error(registry?.error ?? "Invalid production migration registry");
  const versions = new Set();
  for (const { filename } of files) {
    const match = filename.match(/^(\d{14})_([A-Za-z0-9_]+)\.sql$/);
    if (!match) throw new Error(`Invalid migration filename: ${filename}`);
    if (versions.has(match[1]))
      throw new Error(
        `Duplicate migration version ${match[1]}: renumber in a separate PR before deployment`
      );
    versions.add(match[1]);
  }
  const appliedVersions = registry.map(r => r.version);
  if (
    new Set(appliedVersions).size !== registry.length ||
    appliedVersions.some(v => !versions.has(v))
  )
    throw new Error(
      "Production registry contains duplicate or unknown versions"
    );
  const applied = files.filter(f =>
    appliedVersions.includes(f.filename.slice(0, 14))
  );
  if (applied.some((f, i) => f.filename !== files[i].filename))
    throw new Error("Applied migrations are not an ordered repository prefix");
  for (const { filename } of applied) {
    const record = registry.find(r => r.version === filename.slice(0, 14));
    const exception = registryExceptions[record.version];
    const acceptedException =
      exception?.justification?.trim() && record.name === exception.name;
    if (record.name !== filename.slice(15, -4) && !acceptedException)
      throw new Error(`Registry name differs for ${filename}`);
  }
  const pending = files.slice(applied.length);
  const literal = value =>
    "E'" + value.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";
  const expected =
    "array[" + appliedVersions.sort().map(literal).join(",") + "]::text[]";
  const sql = [
    "begin;",
    "set local transaction_read_only=off;",
    "set local lock_timeout='5s';",
    "set local statement_timeout='120s';",
    "select pg_advisory_xact_lock(20261008, 1022);",
    `do $$ begin if coalesce((select array_agg(version order by version) from supabase_migrations.schema_migrations),'{}'::text[]) <> ${expected} then raise exception 'Migration registry changed; rerun dry-run'; end if; end $$;`
  ];
  for (const { filename, source } of pending) {
    sql.push(transactionBody(source, filename));
    sql.push(
      `insert into supabase_migrations.schema_migrations(version,name,statements) values (${literal(filename.slice(0, 14))},${literal(filename.slice(15, -4))},array[${literal(source)}]);`
    );
  }
  sql.push("commit;");
  return {
    applied: applied.map(f => f.filename),
    pending: pending.map(f => f.filename),
    sql: sql.join("\n")
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const directory = new URL("../supabase/migrations/", import.meta.url);
    const files = readdirSync(directory)
      .filter(f => f.endsWith(".sql"))
      .sort()
      .map(filename => ({
        filename,
        source: readFileSync(new URL(filename, directory), "utf8")
      }));
    const plan = deploymentPlan(files, JSON.parse(readFileSync(0, "utf8")));
    // Validate the complete batch on disposable PGlite before any production write.
    const { db } = await replayMigrations({ migrations: plan.applied });
    try {
      await db.exec(
        "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])"
      );
      for (const filename of plan.applied)
        await db.query(
          "insert into supabase_migrations.schema_migrations(version,name) values ($1,$2)",
          [filename.slice(0, 14), filename.slice(15, -4)]
        );
      await db.exec(plan.sql);
    } finally {
      await db.close();
    }
    console.log(JSON.stringify(plan));
  } catch (error) {
    console.error(
      `Deployment refused before any production write: ${error.message}`
    );
    process.exitCode = 1;
  }
}
