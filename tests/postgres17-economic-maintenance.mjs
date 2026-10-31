// Isolated CI PostgreSQL only. Never connects to the VPS.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { bootstrapSQL } from "../scripts/replay-migrations.mjs";
const container = process.env.TEST_POSTGRES_CONTAINER;
assert(container);
assert.equal(
  execFileSync(
    "docker",
    ["inspect", "--format", "{{.Config.Image}}", container],
    { encoding: "utf8" }
  ).trim(),
  "supabase/postgres:17.6.1.136"
);
const database = "economic_gate_ci";
function session(sql, { user = "postgres", db = database } = {}) {
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-w",
      "-qAt",
      "-h",
      "127.0.0.1",
      "-U",
      user,
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1"
    ],
    { stdio: "pipe" }
  );
  let out = "",
    err = "";
  child.stdout.on("data", b => (out += b));
  child.stderr.on("data", b => (err += b));
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err))
    );
  });
  // Attach immediately so expected concurrent errors cannot become unhandled.
  done.catch(() => {});
  child.stdin.write(sql + "\n");
  return { child, done, output: () => out };
}
async function query(sql, options) {
  const s = session(sql, options);
  s.child.stdin.end();
  return s.done;
}
async function until(fn) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(25);
  }
  throw new Error("Gate concurrency timeout");
}
async function ready(s, marker) {
  await Promise.race([
    until(() => s.output().includes(marker)),
    s.done.then(() => {
      throw new Error(`Session exited before ${marker}: ${s.output()}`);
    })
  ]);
}
await query(
  `create database ${database} owner postgres;create role economic_gate_client login noinherit;grant authenticated,service_role to economic_gate_client;`,
  { user: "supabase_admin", db: "postgres" }
);
await query(bootstrapSQL);
const migrations = new URL("../supabase/migrations/", import.meta.url);
for (const name of readdirSync(migrations)
  .filter(n => n.endsWith(".sql"))
  .sort())
  await query(readFileSync(new URL(name, migrations), "utf8"));
const who = "73000000-0000-4000-8000-000000000001";
await query(`insert into auth.users(id,raw_user_meta_data)values('${who}','{"pseudo":"GateConcurrentFixture"}');
create function public.ci_economic_write()returns void language sql security definer set search_path='' as $$update public.user_profiles set karas_balance=karas_balance+1 where user_id='${who}';$$;
grant execute on function public.ci_economic_write()to authenticated;`);
// Use the same SET ROLE path as PostgREST, including SECURITY DEFINER helpers.
// The stale reader only needs a column grant, not the private operator context.
const old = session(
  "set role authenticated;begin isolation level repeatable read;select active from public.economic_maintenance_state;select 'SNAPSHOT_READY';",
  { user: "economic_gate_client" }
);
await ready(old, "SNAPSHOT_READY");
const writer = session(
  "begin;select public.ci_economic_write();select 'WRITER_ADMITTED';"
);
await ready(writer, "WRITER_ADMITTED");
await query(
  "update public.economic_maintenance_state set active=true,started_at=clock_timestamp(),version='CI',operator='CI',reason='CONTROLLED_ECONOMIC_MAINTENANCE_FOR_ADMIN_OPERATION';"
);
const gate = session(
  "set statement_timeout='10000ms';select pg_advisory_lock(710031,2100);select 'DRAINED';"
);
await until(
  async () =>
    Number(
      await query(
        "select count(*)from pg_locks where locktype='advisory' and classid=710031 and objid=2100 and not granted"
      )
    ) === 1
);
assert(
  !gate.output().includes("DRAINED"),
  "Existing writer must drain naturally"
);
await assert.rejects(
  query(
    "set role authenticated;set yokkai.economic_operator='on';select public.ci_economic_write();",
    { user: "economic_gate_client" }
  ),
  /ECONOMIC_MAINTENANCE/
);
writer.child.stdin.end("commit;\n");
await writer.done;
await ready(gate, "DRAINED");
old.child.stdin.end("select public.ci_economic_write();\n");
await assert.rejects(old.done, /ECONOMIC_MAINTENANCE/);
for (const role of ["authenticated", "service_role"]) {
  await assert.rejects(
    query(
      `set role ${role};set yokkai.economic_operator='on';select public.ci_economic_write();`,
      { user: "economic_gate_client" }
    ),
    /ECONOMIC_MAINTENANCE/
  );
  await assert.rejects(
    query(
      `set role ${role};update public.economic_maintenance_state set active=false;`,
      { user: "economic_gate_client" }
    ),
    /permission denied/
  );
  assert.equal(
    await query(
      `set role ${role};select active from public.economic_maintenance_state;`,
      { user: "economic_gate_client" }
    ),
    "t"
  );
}
assert.equal(
  await query(
    `select karas_balance from public.user_profiles where user_id='${who}'`
  ),
  "1"
);
// Reads and non-economic presence updates continue, even with admission closed.
await query(
  `update public.user_profiles set presence_active=true where user_id='${who}';select *from public.cards limit 1;`
);
await query(
  "update public.economic_maintenance_state set active=false,ended_at=clock_timestamp();"
);
gate.child.stdin.end("select pg_advisory_unlock(710031,2100);\n");
await gate.done;
await query("set role authenticated;select public.ci_economic_write();", {
  user: "economic_gate_client"
});
assert.equal(
  await query(
    `select karas_balance from public.user_profiles where user_id='${who}'`
  ),
  "2"
);
console.log(
  "PASS: bounded natural drain, direct RPC/service-role denial, old snapshots, forged GUC rejection, read availability and reopened writes"
);

// Exercise the complete owner-operated batch with fabricated identities only.
// A forced error after Auth changes must roll back cards, balances AND bans.
const ids = [11, 12, 13, 14].map(
  n => `74000000-0000-4000-8000-${String(n).padStart(12, "0")}`
);
const secondary = Array.from(
  { length: 28 },
  (_, n) => `75000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`
);
const copies = Array.from(
  { length: 78 },
  (_, n) => `76000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`
);
await query(`alter table auth.users add column if not exists email text,add column if not exists banned_until timestamptz,add column if not exists updated_at timestamptz;
 create table if not exists auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
 create table if not exists auth.refresh_tokens(id bigint primary key,user_id text,session_id uuid references auth.sessions(id)on delete cascade);
 insert into auth.users(id,raw_user_meta_data,email)values ${[...ids, ...secondary].map((id, n) => `('${id}','{"pseudo":"BatchFixture${n}"}','fixture${n}@example.test')`).join(",")};
 insert into public.referral_codes(user_id,code)values('${ids[0]}','abcdef000001'),('${ids[1]}','abcdef000002');
 insert into public.referrals(id,code_id,referrer_id,referred_id)values ${secondary.map((id, n) => `('${id}',(select id from public.referral_codes where user_id='${ids[n < 21 ? 0 : 1]}'),'${ids[n < 21 ? 0 : 1]}','${id}')`).join(",")};
 insert into auth.sessions(id,user_id)values ${secondary.map(id => `('${id}','${id}')`).join(",")};
 insert into auth.refresh_tokens(id,user_id,session_id)values ${secondary.map((id, n) => `(${n + 1},'${id}','${id}')`).join(",")};
 insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)values('economic-gate-fixture','Fixture','Fixture','Fixture','C','https://example.test/fixture.png','test');
 insert into public.user_cards(id,user_id,card_id,rarity)values ${copies.map((id, n) => `('${id}','${ids[n < 75 ? 0 : n === 75 ? 1 : n === 76 ? 2 : 3]}',(select id from public.cards limit 1),'C')`).join(",")};
 update public.user_profiles set karas_balance=case user_id when '${ids[0]}'then 580 when '${ids[1]}'then 661 when '${ids[2]}'then 1512 else karas_balance end;
 update public.economic_maintenance_state set active=true;`);
const inputs = `create temp table sanction_scope(user_id uuid,operation_id text,sanction_type text,expected_pseudo text,remove_cards boolean,penalize boolean);
create temp table sanction_targets(id uuid primary key);create temp table sanction_config(metadata jsonb,quiescent boolean);
create temp table secondary_scope(operation_id text,user_id uuid,referral_id uuid,sponsor_id uuid,email_domain text);
insert into sanction_config values('{}',false);
insert into sanction_scope values ${ids
  .slice(0, 3)
  .map(
    (id, n) =>
      `('${id}','ci-maintenance-batch-${n}','${["AFFILIATE_ABUSE_SANCTION", "AFFILIATE_ABUSE_WARNING_WITH_PENALTY", "AFFILIATE_ABUSE_WARNING"][n]}','BatchFixture${n}',${n === 0},${n < 2})`
  )
  .join(",")};
insert into sanction_targets values ${copies
  .slice(0, 75)
  .map(id => `('${id}')`)
  .join(",")};
insert into secondary_scope values ${secondary.map((id, n) => `('ci-secondary-${n}','${id}','${id}','${ids[n < 21 ? 0 : 1]}','example.test')`).join(",")};`;
const batch =
  readFileSync(
    new URL(
      "../scripts/sql/apply-referral-sanctions-maintained.sql",
      import.meta.url
    ),
    "utf8"
  ) +
  "\n" +
  readFileSync(
    new URL(
      "../scripts/sql/suspend-reviewed-secondary-accounts.sql",
      import.meta.url
    ),
    "utf8"
  );
await assert.rejects(
  query(
    `select pg_advisory_lock(710031,2100);${inputs}begin;${batch}do $$begin raise exception 'CI_FORCE_ROLLBACK';end;$$;commit;`
  ),
  /CI_FORCE_ROLLBACK/
);
assert.equal(await query("select count(*)from public.account_sanctions"), "0");
assert.equal(
  await query(
    `select karas_balance from public.user_profiles where user_id='${ids[0]}'`
  ),
  "580"
);
assert.equal(
  await query(
    `select count(*)from public.user_cards where user_id='${ids[0]}'`
  ),
  "75"
);
assert.equal(
  await query("select count(*)from auth.users where banned_until>now()"),
  "0"
);
assert.equal(await query("select count(*)from auth.sessions"), "28");
// Same approved IDs, one commit, then a replay that must have no effect.
await query(
  `select pg_advisory_lock(710031,2100);${inputs}begin;${batch}commit;begin;${batch}commit;select pg_advisory_unlock(710031,2100);`
);
assert.deepEqual(
  JSON.parse(
    await query(
      "select json_agg(json_build_array(cards_removed,kara_removed,kara_balance_after,published_at)order by operation_id)from public.account_sanctions"
    )
  ),
  [
    [75, 290, 290, null],
    [0, 330, 331, null],
    [0, 0, 1512, null]
  ]
);
assert.equal(
  await query("select count(*)from auth.users where banned_until>now()"),
  "28"
);
assert.equal(await query("select count(*)from auth.sessions"), "0");
assert.equal(await query("select count(*)from auth.refresh_tokens"), "0");
assert.equal(
  await query(
    "select sum(jsonb_array_length(coalesce(metadata->'secondary_actions','[]')))from public.account_sanctions"
  ),
  "28"
);
assert.equal(
  await query(
    `select count(*)from public.user_cards where id in('${copies[75]}','${copies[76]}','${copies[77]}')`
  ),
  "3"
);
assert.equal(
  await query(
    `select count(*)from public.user_profiles where user_id in(${secondary.map(id => `'${id}'`).join(",")})`
  ),
  "28"
);
assert.equal(await query("select count(*)from public.referrals"), "28");
await assert.rejects(
  query(
    `set role authenticated;select set_config('request.jwt.claim.sub','${secondary[0]}',false);select public.assert_player_not_banned();`,
    { user: "economic_gate_client" }
  ),
  /ACCOUNT_BANNED/
);
await query("update public.economic_maintenance_state set active=false;");
console.log(
  "PASS: forced full rollback, exact 75/28 scope, odd/even half penalty, no duplicate replay, preserved third-party assets/profiles/referrals and old-token ban guard"
);
