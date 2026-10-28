import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";

test("current pseudo is session-only without granting access to private profiles", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"PseudoAlice"}\'),($2,\'{"pseudo":"PseudoBob"}\')',
    [alice, bob]
  );
  await db.query(
    "update public.user_profiles set karas_balance=9876 where user_id=$1",
    [bob]
  );
  async function asUser(id, sql, role = "authenticated") {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? ""
    ]);
    try {
      return (await db.query(sql)).rows;
    } finally {
      await db.exec("reset role");
    }
  }
  await assert.rejects(
    asUser(alice, "select pseudo from public.user_profiles"),
    { code: "42501" }
  );
  assert.equal(
    (
      await asUser(
        alice,
        "select public.get_game_info()->'user'->>'name' as pseudo"
      )
    )[0].pseudo,
    "PseudoAlice"
  );
  assert.equal(
    (
      await asUser(
        bob,
        "select public.get_game_info()->'user'->>'name' as pseudo"
      )
    )[0].pseudo,
    "PseudoBob"
  );
  await assert.rejects(
    asUser(null, "select public.get_game_info()"),
    /AUTH_REQUIRED/
  );
  await assert.rejects(
    asUser(alice, `select public.get_game_info('${bob}'::uuid)`),
    { code: "42883" }
  );
  await assert.rejects(
    asUser(
      alice,
      `select karas_balance from public.user_profiles where user_id='${bob}'`
    ),
    { code: "42501" }
  );
  await assert.rejects(asUser(null, "select public.get_game_info()", "anon"), {
    code: "42501"
  });
});
