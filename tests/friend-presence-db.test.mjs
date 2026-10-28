import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = name =>
  readFileSync(
    new URL(`../supabase/migrations/${name}.sql`, import.meta.url),
    "utf8"
  );
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";
const charlie = "10000000-0000-4000-8000-000000000003";

test("la présence est visible uniquement dans la liste des amis acceptés", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
  `);
  await db.exec(migration("20260923000000_create_card_schema"));
  await db.exec(migration("20260924000006_friendships"));
  await db.exec("alter table public.user_profiles add column avatar_url text");
  await db.exec(migration("20261003000008_social_avatars"));
  await db.exec(migration("20261008000001_friend_presence"));
  await db.query("insert into auth.users values ($1),($2),($3)", [
    alice,
    bob,
    charlie
  ]);
  await db.query(
    "insert into public.user_profiles(user_id,pseudo,last_seen_at,presence_active) values ($1,'Alice',null,false),($2,'Bob',now()-interval '1 minute',true),($3,'Charlie',now(),true)",
    [alice, bob, charlie]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted'),($3,$1,'pending')",
    [alice, bob, charlie]
  );

  async function asUser(id, run, role = "authenticated") {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? ""
    ]);
    try {
      return await run();
    } finally {
      await db.exec("reset role");
    }
  }
  const friendships = async id =>
    (
      await asUser(id, () =>
        db.query("select public.get_friendships() as value")
      )
    ).rows[0].value;
  let result = await friendships(alice);
  assert.equal(result.friends[0].id, bob);
  assert.equal(result.friends[0].isOnline, true);
  assert.ok(result.friends[0].lastSeenAt);
  assert.equal(result.incoming[0].id, charlie);
  assert.equal("isOnline" in result.incoming[0], false);
  assert.equal("lastSeenAt" in result.incoming[0], false);

  await db.query(
    "update public.user_profiles set last_seen_at=now()-interval '11 minutes' where user_id=$1",
    [bob]
  );
  assert.equal((await friendships(alice)).friends[0].isOnline, false);
  assert.ok(
    await asUser(
      bob,
      async () =>
        (await db.query("select public.touch_presence() as value")).rows[0]
          .value
    )
  );
  assert.equal((await friendships(alice)).friends[0].isOnline, true);
  assert.ok(
    await asUser(
      bob,
      async () =>
        (await db.query("select public.mark_offline() as value")).rows[0].value
    )
  );
  result = await friendships(alice);
  assert.equal(result.friends[0].isOnline, false);
  assert.ok(
    Date.now() - new Date(result.friends[0].lastSeenAt).getTime() < 5_000
  );
  await assert.rejects(
    asUser(null, () => db.query("select public.touch_presence()"), "anon"),
    /permission denied/
  );
  await assert.rejects(
    asUser(null, () => db.query("select public.mark_offline()"), "anon"),
    /permission denied/
  );
});
