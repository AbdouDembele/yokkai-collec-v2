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

test("amis des profils publics : RPC, droits et confidentialité", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  // Only Supabase infrastructure is simulated; profile/friendship functions come from migrations.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects (bucket_id text,name text,owner_id text);
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
  `);
  await db.exec(migration("20260923000000_create_card_schema"));
  await db.exec(`alter table public.user_cards
    add column is_shiny boolean default false, add column is_evolved boolean default false,
    add column is_first_owner boolean default true, add column folder_id uuid,
    add column is_locked boolean default false, add column custom_image_url text;`);
  for (const name of [
    "20260924000006_friendships",
    "20260924000008_profiles",
    "20260924000010_profile_banner",
    "20261004000009_profile_showcase_five_cards",
    "20261004000013_profile_collection_privacy"
  ])
    await db.exec(migration(name));
  await db.query("insert into auth.users values ($1),($2),($3)", [
    alice,
    bob,
    charlie
  ]);
  await db.query(
    "insert into public.user_profiles(user_id,pseudo) values ($1,'Alice'),($2,'Bob'),($3,'Charlie')",
    [alice, bob, charlie]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted')",
    [alice, bob]
  );

  async function asUser(id, run, role = "authenticated") {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role })
    ]);
    try {
      return await run();
    } finally {
      await db.exec("reset role");
    }
  }
  const profile = (viewer, identifier) =>
    asUser(
      viewer,
      async () =>
        (await db.query("select public.get_profile($1) as value", [identifier]))
          .rows[0].value
    );
  async function expectPrivate(viewer, identifier) {
    const result = await profile(viewer, identifier);
    assert.deepEqual(result.friends, []);
    assert.equal(result.friendsVisible, false);
    assert.ok(!Object.keys(result).some(key => /friends?count/i.test(key)));
  }
  const functions = async () =>
    (
      await db.query(`select oid::regprocedure::text as signature,prosrc,proacl,prosecdef,proconfig
    from pg_proc where pronamespace='public'::regnamespace order by signature`)
    ).rows;
  const before = await functions();
  const oldDefinition = (
    await db.query(
      "select pg_get_functiondef('public.get_profile(text)'::regprocedure) as value"
    )
  ).rows[0].value;
  const privateFriends = migration("20261007000003_private_friends");
  const next = migration("20261008000000_restore_public_profile_friends");
  assert.equal(
    (privateFriends.match(/create or replace function/gi) ?? []).length,
    1
  );
  assert.equal((next.match(/create or replace function/gi) ?? []).length, 1);
  await db.exec(privateFriends);
  await db.exec(next);

  await t.test(
    "seule get_profile change et ses droits restent identiques",
    async () => {
      const after = await functions();
      assert.deepEqual(
        after.map(row => ({ ...row, prosrc: undefined })),
        before.map(row => ({ ...row, prosrc: undefined }))
      );
      assert.deepEqual(
        after
          .filter((row, index) => row.prosrc !== before[index].prosrc)
          .map(row => row.signature),
        ["get_profile(text)"]
      );
      const rights = (
        await db.query(`select has_function_privilege('authenticated','public.get_profile(text)','EXECUTE') as authenticated,
      has_function_privilege('anon','public.get_profile(text)','EXECUTE') as anon`)
      ).rows[0];
      assert.deepEqual(rights, { authenticated: true, anon: false });
      await assert.rejects(
        asUser(
          alice,
          () => db.query("select public.get_profile(null)"),
          "anon"
        ),
        /permission denied/
      );
    }
  );
  await t.test(
    "profil public : amis visibles par tous les visiteurs",
    async () => {
      await db.query(
        "update public.user_profiles set is_public=true where user_id=$1",
        [alice]
      );
      for (const viewer of [bob, charlie])
        for (const identifier of ["Alice", alice]) {
          const result = await profile(viewer, identifier);
          assert.equal(result.friendsVisible, true);
          assert.deepEqual(
            result.friends.map(friend => friend.id),
            [bob]
          );
        }
    }
  );
  await t.test(
    "profil privé : amis masqués aux visiteurs mais visibles du propriétaire",
    async () => {
      await db.query(
        "update public.user_profiles set is_public=false where user_id=$1",
        [alice]
      );
      for (const viewer of [bob, charlie])
        for (const identifier of ["Alice", alice])
          await expectPrivate(viewer, identifier);
      const owner = await profile(alice, "Alice");
      assert.equal(owner.friendsVisible, true);
      assert.deepEqual(
        owner.friends.map(friend => friend.id),
        [bob]
      );
      assert.equal((await profile(alice, null)).friendsVisible, true);
    }
  );
  await t.test("propriétaire sans ami et retour update_profile", async () => {
    const empty = await profile(charlie, null);
    assert.deepEqual(empty.friends, []);
    assert.equal(empty.friendsVisible, true);
    const saved = await asUser(
      alice,
      async () =>
        (
          await db.query(
            "select public.update_profile('',null,'{}',null) as value"
          )
        ).rows[0].value
    );
    assert.equal(saved.id, alice);
    assert.equal(saved.friendsVisible, true);
    assert.deepEqual(
      saved.friends.map(friend => friend.id),
      [bob]
    );
    assert.equal(
      (
        await asUser(
          alice,
          async () =>
            (await db.query("select public.get_friendships() as value")).rows[0]
              .value
        )
      ).friends[0].id,
      bob
    );
  });
  await t.test(
    "contre-preuve : mêmes assertions rejetées pour les deux visiteurs avec l'ancienne RPC",
    async () => {
      await db.exec(oldDefinition);
      try {
        for (const viewer of [bob, charlie]) {
          await assert.rejects(expectPrivate(viewer, "Alice"), {
            name: "AssertionError"
          });
          const leaked = await profile(viewer, "Alice");
          assert.equal(leaked.friends.length, 1);
          assert.equal(leaked.friendsVisible, undefined);
        }
      } finally {
        await db.exec(privateFriends);
        await db.exec(next);
      }
      for (const viewer of [bob, charlie]) await expectPrivate(viewer, "Alice");
    }
  );
});
