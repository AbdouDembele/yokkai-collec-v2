import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { readFileSync, readdirSync } from "node:fs";
import {
  replayMigrations,
  securityDefinerAccess
} from "../scripts/replay-migrations.mjs";
import allowlist from "./security-definer-allowlist.mjs";
import * as accessPolicy from "./security-definer-allowlist.mjs";

test("billing deletion helper has an explicit owner-only access policy", async t => {
  const signature = "public.prepare_account_deletion_without_billing(uuid)";
  assert.ok(
    accessPolicy.ownerOnly?.includes(signature),
    "Register the billing bypass helper as owner-only"
  );
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const helper of accessPolicy.ownerOnly) {
    const { rows } = await db.query(
      `
      select p.proacl is not null as explicit,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
        has_function_privilege(p.proowner, p.oid, 'EXECUTE') as owner,
        exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') as public
      from pg_proc p where p.oid=$1::regprocedure`,
      [helper]
    );
    assert.deepEqual(
      rows,
      [
        {
          explicit: true,
          anon: false,
          authenticated: false,
          service_role: false,
          owner: true,
          public: false
        }
      ],
      helper
    );
  }
  assert.deepEqual(
    (
      await db.query(`select p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proacl is null`)
    ).rows,
    [],
    "Every public function must have explicit ACLs"
  );
});

test("migration versions are unique", () => {
  const names = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter(name => name.endsWith(".sql"))
    .sort();
  const versions = new Map();
  for (const name of names) {
    const version = name.match(/^(\d{14})_/)?.[1];
    assert.ok(version, `Invalid migration filename: ${name}`);
    assert.ok(
      !versions.has(version),
      `Duplicate migration version ${version}: ${versions.get(version)} and ${name}`
    );
    versions.set(version, name);
  }
});

test("all migrations replay with Supabase defaults; SECURITY DEFINER access is explicitly allowed", async t => {
  const start = performance.now();
  const { db, migrations } = await replayMigrations();
  t.after(() => db.close());
  await t.test("public sequences expose no player privileges", async () => {
    const { rows } = await db.query(`
      select n.nspname || '.' || c.relname as sequence, r.role, p.privilege,
        has_sequence_privilege(r.role, c.oid, p.privilege) as granted
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join (values ('anon'), ('authenticated')) r(role)
      cross join (values ('SELECT'), ('UPDATE'), ('USAGE')) p(privilege)
      where n.nspname='public' and c.relkind='S'
      order by sequence, role, privilege
    `);
    t.diagnostic(
      `Public sequences: ${[...new Set(rows.map(row => row.sequence))].join(", ")}`
    );
    assert.deepEqual(
      rows.filter(row => row.granted),
      [],
      "Unexpected public sequence grants"
    );
  });
  await t.test(
    "admin audit identity inserts survive sequence revocation",
    async () => {
      // Auth columns used by the moderation RPC are outside the replay's minimal stub.
      await db.exec(
        "alter table auth.users add column banned_until timestamptz, add column updated_at timestamptz"
      );
      const admin = "10000000-0000-4000-8000-000000000099";
      const player = "10000000-0000-4000-8000-000000000098";
      await db.query(
        'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"SequenceAdmin"}\')',
        [admin]
      );
      await db.query(
        'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"SequencePlayer"}\')',
        [player]
      );
      await db.query("insert into public.admin_users(user_id) values ($1)", [
        admin
      ]);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        admin
      ]);
      try {
        await db.exec("set role authenticated");
        await db.query(
          "insert into public.admin_audit_logs(admin_user_id,action) values ($1,'card.create')",
          [admin]
        );
        await db.query("select public.admin_set_user_ban($1,false)", [player]);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          player
        ]);
        await assert.rejects(
          db.query(
            "insert into public.admin_audit_logs(admin_user_id,action) values ($1,'card.create')",
            [player]
          ),
          { code: "42501" }
        );
        for (const sql of [
          "select nextval('public.admin_audit_logs_id_seq')",
          "select setval('public.admin_audit_logs_id_seq',1)",
          "select last_value from public.admin_audit_logs_id_seq"
        ]) {
          await assert.rejects(db.exec(sql), { code: "42501" });
        }
        await db.exec("set role anon");
        await assert.rejects(
          db.exec("select nextval('public.admin_audit_logs_id_seq')"),
          { code: "42501" }
        );
      } finally {
        await db.exec("reset role");
      }
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from public.admin_audit_logs where admin_user_id=$1",
            [admin]
          )
        ).rows[0].count,
        2
      );
    }
  );
  const access = await securityDefinerAccess(db);
  const violations = access.filter(
    ({ signature, role, executable }) =>
      executable && !allowlist[signature]?.includes(role)
  );
  assert.deepEqual(
    violations,
    [],
    "Unexpected SECURITY DEFINER EXECUTE grants"
  );
  for (const [signature, roles] of Object.entries(allowlist)) {
    assert.ok(
      roles.length &&
        roles.every(role => ["anon", "authenticated"].includes(role))
    );
    for (const role of roles) {
      assert.ok(
        access.some(
          row =>
            row.signature === signature && row.role === role && row.executable
        ),
        `Stale allowlist entry: ${signature} / ${role}`
      );
    }
  }
  t.diagnostic(
    `${migrations.length}/${migrations.length} migrations; ${access.length / 2} SECURITY DEFINER functions; ${(performance.now() - start).toFixed(0)} ms`
  );
  await t.test(
    "catalogue detects public SECURITY DEFINER ownership changes",
    async () => {
      const sql = readFileSync(
        new URL("../scripts/schema-catalog.sql", import.meta.url),
        "utf8"
      );
      const credit = async () =>
        (await db.query(sql)).rows
          .map(row => JSON.parse(Object.values(row)[0]))
          .find(
            row =>
              row.kind === "function" &&
              row.name === "public.credit_karas(uuid, integer)"
          );
      const before = await credit();
      assert.equal(
        before.value.owner,
        (await db.query("select current_user as owner")).rows[0].owner
      );
      await db.exec(
        "create role migration_owner; alter function public.credit_karas(uuid, integer) owner to migration_owner"
      );
      const after = await credit();
      assert.equal(after.value.owner, "migration_owner");
      assert.deepEqual(
        { ...before.value, owner: after.value.owner },
        after.value,
        "Owner-only changes must remain visible even when definition and grants match"
      );
    }
  );
});

test("profile RLS isolates players even after a SELECT grant", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const alice = "10000000-0000-4000-8000-000000000001";
  const bob = "10000000-0000-4000-8000-000000000002";
  await db.query(
    `insert into auth.users(id, raw_user_meta_data) values
    ($1, '{"pseudo":"PolicyAlice"}'), ($2, '{"pseudo":"PolicyBob"}')`,
    [alice, bob]
  );
  // Existing client reads must remain behind explicit SECURITY DEFINER RPCs.
  assert.deepEqual(
    (
      await db.query(`select p.proname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not p.prosecdef
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and p.prosrc ~* '\\muser_profiles\\M'`)
    ).rows,
    []
  );
  assert.deepEqual(
    (
      await db.query(`select viewname from pg_views
    where schemaname='public' and definition ~* '\\muser_profiles\\M'`)
    ).rows,
    []
  );
  await db.exec("begin");
  try {
    await db.exec(
      "grant select on public.user_profiles to authenticated; set local role authenticated"
    );
    for (const [viewer, other] of [
      [alice, bob],
      [bob, alice]
    ]) {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        viewer
      ]);
      assert.deepEqual(
        (await db.query("select user_id from public.user_profiles")).rows,
        [{ user_id: viewer }],
        "SELECT must expose only the caller's profile"
      );
      assert.deepEqual(
        (
          await db.query(
            "select user_id from public.user_profiles where user_id=$1",
            [other]
          )
        ).rows,
        []
      );
      assert.equal(
        (await db.query("select public.get_profile($1) as profile", [other]))
          .rows[0].profile.id,
        other
      );
    }
    await db.query("select set_config('request.jwt.claim.sub','',true)");
    assert.deepEqual(
      (await db.query("select user_id from public.user_profiles")).rows,
      []
    );
  } finally {
    await db.exec("rollback");
  }
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','public.user_profiles','SELECT') as allowed"
      )
    ).rows[0].allowed,
    false
  );
});
