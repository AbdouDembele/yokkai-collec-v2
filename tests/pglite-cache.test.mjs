import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// File symlinks need extra rights on Windows; CI runs on Linux.
const linux = {
  skip: process.platform === "win32" ? "file symlinks; runs on Linux CI" : false
};

// Copy of replay-migrations.mjs over a PGlite package whose version we control;
// the real files are linked, only package.json differs.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "yokkai-pglite-cache-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const real = path.resolve("node_modules/@electric-sql/pglite");
  const pkg = path.join(directory, "node_modules/@electric-sql/pglite");
  mkdirSync(pkg, { recursive: true });
  for (const name of readdirSync(real))
    if (name !== "package.json")
      symlinkSync(path.join(real, name), path.join(pkg, name));
  mkdirSync(path.join(directory, "scripts"));
  mkdirSync(path.join(directory, "supabase/migrations"), { recursive: true });
  cpSync(
    "scripts/replay-migrations.mjs",
    path.join(directory, "scripts/replay-migrations.mjs")
  );
  let loads = 0;
  return {
    cache: version =>
      path.join(
        directory,
        "node_modules/.cache/yokkai-pglite",
        `empty-${version}.tar`
      ),
    migration: (name, sql) =>
      writeFileSync(path.join(directory, "supabase/migrations", name), sql),
    // A fresh module instance reads the version again.
    async replay(version, options) {
      const manifest = JSON.parse(
        readFileSync(path.join(real, "package.json"), "utf8")
      );
      writeFileSync(
        path.join(pkg, "package.json"),
        JSON.stringify({ ...manifest, version })
      );
      const replayModule = await import(
        `${pathToFileURL(path.join(directory, "scripts/replay-migrations.mjs"))}?load=${++loads}`
      );
      return replayModule.replayMigrations(options);
    }
  };
}
// Close before asserting: a database loaded from a datadir keeps a timer
// alive, so a failed assertion must not leave it open and hang the run.
const replayHasMarker = async (f, version) => {
  const { db } = await f.replay(version, { migrations: [] });
  try {
    return (
      await db.query("select to_regclass('public.cache_marker') is not null m")
    ).rows[0].m;
  } finally {
    await db.close();
  }
};

test(
  "a PGlite version change invalidates the empty-cluster cache; off disables it",
  linux,
  async t => {
    const f = fixture(t);
    // Plant a recognisable cluster under version A: reading it shows the marker.
    const planted = await PGlite.create({ extensions: { pg_trgm } });
    await planted.exec("create table public.cache_marker()");
    mkdirSync(path.dirname(f.cache("0.0.0-a")), { recursive: true });
    writeFileSync(
      f.cache("0.0.0-a"),
      Buffer.from(await (await planted.dumpDataDir("none")).arrayBuffer())
    );
    await planted.close();

    assert.equal(
      await replayHasMarker(f, "0.0.0-a"),
      true,
      "same version reads the cache"
    );
    assert.equal(
      await replayHasMarker(f, "0.0.0-b"),
      false,
      "another version ignores it"
    );
    assert.ok(existsSync(f.cache("0.0.0-b")), "and writes its own entry");

    process.env.YOKKAI_PGLITE_CACHE = "off";
    t.after(() => delete process.env.YOKKAI_PGLITE_CACHE);
    assert.equal(
      await replayHasMarker(f, "0.0.0-a"),
      false,
      "off never reads the cache"
    );
    await replayHasMarker(f, "0.0.0-c");
    assert.equal(existsSync(f.cache("0.0.0-c")), false, "off never writes it");
  }
);

test(
  "the cache holds only an empty cluster, never bootstrap, migrations or data",
  linux,
  async t => {
    const f = fixture(t);
    f.migration(
      "20990101000000_fixture.sql",
      "create table public.fixture(id int); insert into public.fixture values (1);"
    );
    const { db } = await f.replay("0.0.0-empty");
    const rows = (await db.query("select count(*)::int n from public.fixture"))
      .rows[0].n;
    await db.close();
    assert.equal(rows, 1, "the replay itself did run the migration");

    const fingerprint = async database =>
      (
        await database.query(`select json_build_object(
        'namespaces', (select json_agg(nspname order by nspname) from pg_namespace),
        'roles', (select json_agg(rolname order by rolname) from pg_roles),
        'databases', (select json_agg(datname order by datname) from pg_database),
        'relations', (select count(*) from pg_class),
        'functions', (select count(*) from pg_proc),
        'extensions', (select json_agg(extname order by extname) from pg_extension)
      ) f`)
      ).rows[0].f;
    const cached = await PGlite.create({
      extensions: { pg_trgm },
      loadDataDir: new Blob([readFileSync(f.cache("0.0.0-empty"))])
    });
    const cold = await PGlite.create({ extensions: { pg_trgm } });
    try {
      const content = await fingerprint(cached);
      assert.deepEqual(
        content,
        await fingerprint(cold),
        "same as a fresh initdb"
      );
      for (const name of ["auth", "storage", "cron"])
        assert.ok(!content.namespaces.includes(name), name);
      for (const role of ["anon", "authenticated", "service_role"])
        assert.ok(!content.roles.includes(role), role);
      assert.equal(
        (await cached.query("select to_regclass('public.fixture') r")).rows[0]
          .r,
        null
      );
    } finally {
      await cached.close();
      await cold.close();
    }
  }
);
