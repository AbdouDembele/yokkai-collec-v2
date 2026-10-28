import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

// Disposable replay only: this never connects to or migrates production.
test("locale RPCs expose only the caller's preference and grant no column access", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const first = "78000000-0000-4000-8000-000000000001";
  const second = "78000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [first, "LocaleFirst"],
    [second, "LocaleSecond"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  const login = async id => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  await login(first);
  assert.equal(
    (await db.query("select public.get_my_locale() locale")).rows[0].locale,
    null
  );
  await db.exec("select public.set_my_locale('fr')");
  assert.equal(
    (await db.query("select public.get_my_locale() locale")).rows[0].locale,
    "fr"
  );
  await assert.rejects(
    db.exec("select locale from public.user_profiles"),
    /permission denied/
  );
  await assert.rejects(
    db.exec("update public.user_profiles set locale='en'"),
    /permission denied/
  );
  await assert.rejects(
    db.exec("select public.set_my_locale('de')"),
    /INVALID_LOCALE/
  );
  await login(second);
  assert.equal(
    (await db.query("select public.get_my_locale() locale")).rows[0].locale,
    null
  );
  await db.exec("select public.set_my_locale('en')");
  await login(first);
  assert.equal(
    (await db.query("select public.get_my_locale() locale")).rows[0].locale,
    "fr"
  );
  await db.exec("select public.set_my_locale(null)");
  assert.equal(
    (await db.query("select public.get_my_locale() locale")).rows[0].locale,
    null
  );
  await db.exec(
    "reset role; alter table auth.users add column banned_until timestamptz"
  );
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    second
  ]);
  await login(second);
  await assert.rejects(
    db.exec("select public.set_my_locale('fr')"),
    /ACCOUNT_BANNED/
  );
  assert.equal(
    (await db.query("select public.get_my_locale() locale")).rows[0].locale,
    "en"
  );
  await db.exec("reset role; set role anon");
  await assert.rejects(
    db.exec("select public.get_my_locale()"),
    /permission denied/
  );
  await assert.rejects(
    db.exec("select public.set_my_locale('fr')"),
    /permission denied/
  );
});
