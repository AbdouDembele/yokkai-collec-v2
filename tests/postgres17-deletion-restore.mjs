// No URLs, credentials, published ports or production access: this script owns its container.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { bootstrapSQL } from "../scripts/replay-migrations.mjs";

const started = Date.now();
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  }).trim();
const endpoint =
  process.env.DOCKER_HOST ||
  docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
assert.match(
  endpoint,
  /^(?:npipe:\/\/\/\/\.\/pipe\/|unix:\/\/\/)/,
  "Only a local disposable Docker engine is allowed"
);
const container = docker([
  "run",
  "--detach",
  "--network",
  "none",
  "--env",
  "POSTGRES_USER=supabase_admin",
  "--env",
  "POSTGRES_HOST_AUTH_METHOD=trust",
  "--tmpfs",
  "/docker-entrypoint-initdb.d",
  "supabase/postgres:17.6.1.136"
]);
const erased = "10000000-0000-4000-8000-000000000001";
const player = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const card = "20000000-0000-4000-8000-000000000001";
const instance = n => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const auction = n => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (statement, db = "deletion_live") =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "supabase_admin",
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1"
    ],
    statement
  );
const prepare = `set role service_role; select public.prepare_account_deletion('${erased}'); reset role;`;
// Platform APIs are deliberately simulated only in these disposable databases.
const finish = `delete from storage.objects where owner_id='${erased}' or split_part(name,'/',1)='${erased}'; delete from auth.users where id='${erased}';`;
const economy = `select coalesce(sum(karas_balance),0)+(select coalesce(sum(current_price),0) from public.auctions where status='active' and buyer_id is not null) from public.user_profiles`;
const balances = `select json_agg(row_to_json(p) order by user_id) from (select user_id,karas_balance from public.user_profiles) p`;
try {
  for (let i = 0; ; i++) {
    try {
      sql("select 1", "postgres");
      break;
    } catch (e) {
      if (i === 120) throw e;
      await delay(1000);
    }
  }
  sql(
    "create role postgres login nosuperuser bypassrls createrole; create role anon; create role authenticated; create role service_role bypassrls; create database deletion_live owner postgres; create database deletion_restored owner postgres;",
    "postgres"
  );
  sql(`set role postgres; ${bootstrapSQL}`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = readdirSync(directory)
    .filter(n => n.endsWith(".sql"))
    .sort();
  for (const name of migrations)
    sql(`set role postgres; ${readFileSync(new URL(name, directory), "utf8")}`);
  console.log(`PASS PostgreSQL 17: ${migrations.length} migrations replayed`);
  sql(`insert into auth.users(id,raw_user_meta_data) values ${[1, 2, 3, 4, 5].map(n => `('${player(n)}','{"pseudo":"Synthetic${n}"}')`).join(",")};
    update public.user_profiles set karas_balance=1000;
    insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('${card}','synthetic','SYNTHETIC','ANIME/MANGA','TEST','C','https://example.test/card.png','manual');
    insert into public.user_cards(id,user_id,card_id,rarity) values ('${instance(1)}','${erased}','${card}','C'),('${instance(2)}','${player(3)}','${card}','C');
    insert into public.auctions(id,card_instance_id,seller_id,buyer_id,current_price,starting_price,duration_minutes,ends_at) values
      ('${auction(1)}','${instance(1)}','${erased}','${player(2)}',40,10,60,now()+interval '1 hour'),
      ('${auction(2)}','${instance(2)}','${player(3)}','${erased}',30,10,60,now()+interval '1 minute');
    insert into public.bids(auction_id,bidder_id,amount) values ('${auction(1)}','${player(2)}',40),('${auction(2)}','${erased}',30);
    update public.user_profiles set karas_balance=karas_balance-40 where user_id='${player(2)}';
    update public.user_profiles set karas_balance=karas_balance-30 where user_id='${erased}';
    insert into public.friendships(user_id,friend_id,status) values ('${erased}','${player(4)}','accepted');
    insert into public.trade_offers(from_user,to_user,offered_karas,status) values ('${erased}','${player(4)}',10,'pending'),('${player(4)}','${erased}',20,'pending');
    insert into public.auction_chat_messages(auction_id,user_id,message) values ('${auction(2)}','${erased}','Synthetic private message');
    insert into public.card_shares(card_id,owner_id,card_name,franchise,rarity,shiny,catalogue_image_url) values ('${card}','${erased}','SYNTHETIC','TEST','C',false,'https://example.test/card.png');
    insert into public.card_share_creations(owner_id) values ('${erased}');
    insert into public.user_reports(reporter_id,reported_id,reason,context_type,snapshot,details) values ('${player(5)}','${erased}','spam','profile','{"pseudo":"Synthetic1"}','Synthetic private details');
    insert into public.user_blocks(blocker_id,blocked_id) values ('${erased}','${player(5)}'),('${player(4)}','${erased}');
    insert into public.friendships(user_id,friend_id,status) values ('${erased}','${player(2)}','accepted');
    insert into storage.objects(bucket_id,name,owner_id) values ('avatars','${erased}/avatar.png','${erased}');`);
  assert.equal(sql(economy), "5000");
  docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    "supabase_admin",
    "-d",
    "deletion_live",
    "-Fc",
    "-f",
    "/tmp/before.dump"
  ]);
  sql(
    `set role service_role; select public.begin_account_deletion('${erased}');`
  );
  const journal = sql(
    "copy (select user_id,deleted_at from public.account_deletion_log order by user_id) to stdout with csv"
  );
  // Inject failure late in the SQL transaction, after auction refunds but before profile cleanup.
  sql(
    "create function public.fail_deletion_test() returns trigger language plpgsql as $$begin raise exception 'INJECTED_FAILURE'; end;$$; create trigger fail_deletion_test before delete on public.user_profiles for each statement execute function public.fail_deletion_test();"
  );
  assert.throws(() => sql(prepare), /INJECTED_FAILURE/);
  assert.equal(sql(economy), "5000");
  assert.equal(
    sql(
      "select count(*) from public.auctions where status='active' and buyer_id is not null"
    ),
    "2"
  );
  sql(
    "drop trigger fail_deletion_test on public.user_profiles; drop function public.fail_deletion_test();"
  );
  sql(prepare);
  const after = sql(balances);
  sql(prepare); // Simulated failure at the Storage/API boundary: repeat committed SQL.
  assert.equal(sql(balances), after);
  assert.equal(
    sql(
      `select karas_balance from public.user_profiles where user_id='${player(2)}'`
    ),
    "1000"
  );
  assert.equal(sql(economy), "4000"); // The removed account's 1000 Karas are retired, never transferred.
  assert.equal(
    sql(
      `select (buyer_id is null and current_price=starting_price and ends_at>now()+interval '3 minutes') from public.auctions where id='${auction(2)}'`
    ),
    "t"
  );
  assert.equal(
    sql("select count(*) from public.trade_offers where status='cancelled'"),
    "2"
  );
  sql(finish);
  sql(prepare + finish);
  assert.equal(sql(balances), after);
  console.log(
    "PASS failure rollback, retry after SQL/API boundary, refunds exactly once; 5000 = 4000 surviving + 1000 retired Karas"
  );
  docker([
    "exec",
    container,
    "pg_restore",
    "-U",
    "supabase_admin",
    "-d",
    "deletion_restored",
    "--exit-on-error",
    "/tmp/before.dump"
  ]);
  assert.equal(
    sql(
      `select count(*) from auth.users where id='${erased}'`,
      "deletion_restored"
    ),
    "1"
  );
  assert.equal(
    sql(
      "select count(*) from public.account_deletion_log",
      "deletion_restored"
    ),
    "0"
  );
  sql(
    `copy public.account_deletion_log(user_id,deleted_at) from stdin with csv;\n${journal}\n\\.\n`,
    "deletion_restored"
  );
  sql(prepare + finish, "deletion_restored");
  sql(prepare + finish, "deletion_restored");
  assert.equal(sql(balances, "deletion_restored"), after);
  // Every query is printed to the evidence log: UUID/text residues and all FK orphans.
  for (const db of ["deletion_live", "deletion_restored"]) {
    const tables = JSON.parse(
      sql(
        "select json_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname in ('public','auth','storage') and tablename<>'account_deletion_log'",
        db
      )
    );
    for (const table of tables) {
      const check = `select count(*) from ${table} t where position('${erased}' in to_jsonb(t)::text)>0 or position('Synthetic1' in to_jsonb(t)::text)>0 or position('Synthetic private' in to_jsonb(t)::text)>0;`;
      assert.equal(sql(check, db), "0", `${db}: ${table} residue`);
      console.log(`${db}: 0 residues | ${check}`);
    }
    const checks = JSON.parse(
      sql(
        `select json_agg(q) from (select format('select count(*) from %s c where %s and not exists(select 1 from %s p where %s);', conrelid::regclass,
      string_agg(format('c.%I is not null',ca.attname),' and ' order by k.i), confrelid::regclass,
      string_agg(format('p.%I=c.%I',pa.attname,ca.attname),' and ' order by k.i)) q
      from pg_constraint cross join lateral generate_subscripts(conkey,1) k(i)
      join pg_attribute ca on ca.attrelid=conrelid and ca.attnum=conkey[k.i]
      join pg_attribute pa on pa.attrelid=confrelid and pa.attnum=confkey[k.i]
      where contype='f' and connamespace in ('public'::regnamespace,'auth'::regnamespace,'storage'::regnamespace) group by pg_constraint.oid,conrelid,confrelid) s`,
        db
      )
    );
    for (const check of checks) {
      assert.equal(sql(check, db), "0", check);
      console.log(`${db}: 0 orphans | ${check}`);
    }
    assert.equal(
      sql(
        `select count(*) from public.account_deletion_log where user_id='${erased}'`,
        db
      ),
      "1"
    );
  }
  console.log(
    `PASS pre-deletion pg_dump/pg_restore + independent deletion journal replay; ${((Date.now() - started) / 1000).toFixed(1)} s`
  );
} finally {
  docker(["rm", "--force", "--volumes", container]);
}
