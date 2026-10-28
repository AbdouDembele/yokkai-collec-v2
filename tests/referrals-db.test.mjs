import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const referrer = "71000000-0000-4000-8000-000000000001";
const referred = "71000000-0000-4000-8000-000000000002";

test("a verified referral grants five bonus packs to both players exactly once", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const login = async id => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const admin = () => db.exec("reset role");

  await db.query(
    "insert into auth.users(id,raw_user_meta_data,email_confirmed_at) values($1,$2::jsonb,clock_timestamp())",
    [referrer, JSON.stringify({ pseudo: "Referrer" })]
  );
  await login(referrer);
  const code = (await db.query("select public.create_referral_code() value"))
    .rows[0].value;
  assert.match(code, /^[a-f0-9]{12}$/);
  assert.equal(
    (await db.query("select public.create_referral_code() value")).rows[0]
      .value,
    code,
    "code creation is idempotent"
  );

  await admin();
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [referred, JSON.stringify({ pseudo: "Referred", referral_code: code })]
  );
  assert.equal(
    (
      await db.query(
        "select bonus_regular_packs value from public.user_profiles where user_id=$1",
        [referrer]
      )
    ).rows[0].value,
    0,
    "creating an unverified account grants nothing"
  );
  assert.equal(
    (
      await db.query(
        "select bonus_regular_packs value from public.user_profiles where user_id=$1",
        [referred]
      )
    ).rows[0].value,
    0,
    "the unverified referred player receives nothing yet"
  );

  await db.query(
    "update auth.users set email_confirmed_at=clock_timestamp() where id=$1",
    [referred]
  );
  assert.equal(
    (
      await db.query(
        "select bonus_regular_packs value from public.user_profiles where user_id=$1",
        [referrer]
      )
    ).rows[0].value,
    5
  );
  await db.query(
    "update auth.users set email_confirmed_at=email_confirmed_at+interval '1 second' where id=$1",
    [referred]
  );
  assert.equal(
    (
      await db.query(
        "select bonus_regular_packs value from public.user_profiles where user_id=$1",
        [referrer]
      )
    ).rows[0].value,
    5,
    "later Auth updates cannot award the referral twice"
  );
  assert.equal(
    (
      await db.query(
        "select bonus_regular_packs value from public.user_profiles where user_id=$1",
        [referred]
      )
    ).rows[0].value,
    5,
    "the verified referred player also receives five packs exactly once"
  );

  await login(referrer);
  const referralStatus = (
    await db.query("select public.get_referral_status() value")
  ).rows[0].value;
  assert.deepEqual(referralStatus, {
    code,
    verifiedReferrals: 1,
    packsEarned: 5,
    bonusPacks: 5
  });
  const packStatus = (
    await db.query("select public.get_regular_pack_status() value")
  ).rows[0].value;
  assert.equal(packStatus.bonus, 5);
  assert.equal(packStatus.available, packStatus.reserve + 5);

  await admin();
  for (const rarity of ["C", "R", "SR", "SSR", "LR"])
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','Referral',$2,'https://example.test/card.png','test')",
      [`referral-${rarity}`, rarity]
    );
  await db.query(
    "update public.user_profiles set next_regular_pack_at=clock_timestamp()+interval '1 hour' where user_id=$1",
    [referrer]
  );
  await login(referrer);
  await db.query("select public.open_regular_pack()");
  const afterOpen = (
    await db.query("select public.get_regular_pack_status() value")
  ).rows[0].value;
  assert.equal(afterOpen.bonus, 4);
  assert.equal(afterOpen.reserve, 0);

  await login(referred);
  for (const sql of [
    "select * from public.referral_codes",
    "select * from public.referrals",
    "select public.complete_referral_after_verification('71000000-0000-4000-8000-000000000002',clock_timestamp())"
  ])
    await assert.rejects(db.query(sql), /permission denied/);
});

test("invalid or unknown referral codes never block account creation or grant packs", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = "71000000-0000-4000-8000-000000000003";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [
      user,
      JSON.stringify({ pseudo: "NoSponsor", referral_code: "ffffffffffff" })
    ]
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer value from public.referrals where referred_id=$1",
        [user]
      )
    ).rows[0].value,
    0
  );
});
