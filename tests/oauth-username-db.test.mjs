import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const referrer = "72000000-0000-4000-8000-000000000001";
const oauthPlayer = "72000000-0000-4000-8000-000000000002";
const emailPlayer = "72000000-0000-4000-8000-000000000003";
const other = "72000000-0000-4000-8000-000000000004";

test("OAuth sign-ups get a pending username, chosen once with signup rules and the referral", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  let current;
  const login = async id => {
    current = id;
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const admin = () => {
    current = undefined;
    return db.exec("reset role");
  };
  const profile = async id => {
    const caller = current;
    await db.exec("reset role");
    const { rows } = await db.query(
      "select pseudo,exists(select 1 from public.oauth_pseudo_pending o where o.user_id=p.user_id) pseudo_required,bonus_regular_packs from public.user_profiles p where user_id=$1",
      [id]
    );
    if (caller) await login(caller);
    return rows[0];
  };
  const rejects = (sql, params, code) =>
    assert.rejects(db.query(sql, params), new RegExp(code, "i"));

  await db.query(
    "insert into auth.users(id,raw_user_meta_data,email_confirmed_at) values($1,$2::jsonb,clock_timestamp())",
    [referrer, JSON.stringify({ pseudo: "Referrer" })]
  );
  await login(referrer);
  const code = (await db.query("select public.create_referral_code() value"))
    .rows[0].value;
  await admin();

  // Email sign-up keeps its strict trigger.
  await rejects(
    "insert into auth.users(id,raw_user_meta_data,raw_app_meta_data) values($1,'{}','{\"provider\":\"email\"}')",
    [emailPlayer],
    "pseudo"
  );
  await rejects(
    "insert into auth.users(id,raw_user_meta_data) values($1,'{}')",
    [emailPlayer],
    "pseudo"
  );

  // GoTrue stores provider identity data, never a username.
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,raw_app_meta_data,email_confirmed_at) values($1,$2::jsonb,$3::jsonb,clock_timestamp())",
    [
      oauthPlayer,
      JSON.stringify({ full_name: "Some Name", email_verified: true }),
      JSON.stringify({ provider: "google", providers: ["google"] })
    ]
  );
  const pending = await profile(oauthPlayer);
  assert.equal(pending.pseudo_required, true);
  assert.match(pending.pseudo, /^player-[0-9a-f]{16}$/);
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,raw_app_meta_data) values($1,'{}',$2::jsonb)",
    [other, JSON.stringify({ provider: "discord" })]
  );
  assert.equal((await profile(other)).pseudo_required, true);

  await login(oauthPlayer);
  assert.equal(
    (await db.query("select public.is_pseudo_required() value")).rows[0].value,
    true
  );
  for (const [pseudo, error] of [
    ["ab", "PSEUDO_TOO_SHORT"],
    ["x".repeat(31), "PSEUDO_TOO_LONG"],
    ["bad/name", "PSEUDO_INVALID_CHARACTERS"],
    ["referrer", "PSEUDO_TAKEN"]
  ])
    await rejects("select public.choose_pseudo($1,$2)", [pseudo, code], error);
  assert.equal((await profile(oauthPlayer)).pseudo_required, true);

  await db.query("select public.choose_pseudo($1,$2)", ["  OAuthHero ", code]);
  assert.deepEqual(await profile(oauthPlayer), {
    pseudo: "OAuthHero",
    pseudo_required: false,
    bonus_regular_packs: 5
  });
  assert.equal(
    (await db.query("select public.is_pseudo_required() value")).rows[0].value,
    false
  );
  await rejects(
    "select public.choose_pseudo($1,$2)",
    ["OtherName", code],
    "PSEUDO_ALREADY_CHOSEN"
  );

  await login(referrer);
  assert.equal(
    (await profile(referrer)).bonus_regular_packs,
    5,
    "the referrer is rewarded exactly like an email referral"
  );
  await rejects(
    "select public.choose_pseudo($1,null)",
    ["Renamed"],
    "PSEUDO_ALREADY_CHOSEN"
  );

  await db.exec("reset role; set role anon");
  await rejects(
    "select public.choose_pseudo('Anon',null)",
    [],
    "permission denied"
  );
  await rejects("select public.is_pseudo_required()", [], "permission denied");
});
