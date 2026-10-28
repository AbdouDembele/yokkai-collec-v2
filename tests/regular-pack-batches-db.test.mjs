import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = "7c000000-0000-4000-8000-000000000001";
const other = "7c000000-0000-4000-8000-000000000002";

test("Regular Pack batches reuse authoritative draws, enforce exact quantities and roll back the whole transaction", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [player, "BatchPlayer"],
    [other, "BatchOther"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  for (const rarity of ["C", "R", "SR", "SSR", "LR"])
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','Batch',$2,'https://example.test/card.png','test')",
      [`batch-${rarity}`, rarity]
    );
  const login = async (id = player) => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const resetReserve = async (bonus = 0) => {
    await db.exec("reset role");
    await db.query(
      "update public.user_profiles set next_regular_pack_at=clock_timestamp()-interval '2 hours',bonus_regular_packs=$2 where user_id=$1",
      [player, bonus]
    );
    await login();
  };
  const draw = count =>
    db
      .query("select public.open_regular_packs($1) value", [count])
      .then(result => result.rows[0].value);
  const snapshot = async () => {
    await db.exec("reset role");
    const result = (
      await db.query(`select jsonb_build_object(
      'profiles',(select jsonb_agg(to_jsonb(p) order by user_id) from public.user_profiles p),
      'cards',(select jsonb_agg(to_jsonb(c) order by id) from public.user_cards c),
      'stats',(select jsonb_agg(to_jsonb(s) order by user_id) from public.user_achievement_stats s),
      'achievements',(select jsonb_agg(to_jsonb(a) order by user_id,achievement_id) from public.user_achievements a),
      'notifications',(select jsonb_agg(to_jsonb(n) order by id) from public.notifications n)
    ) value`)
    ).rows[0].value;
    await login();
    return result;
  };
  await t.test("explicit invoker ACLs add no privileged surface", async () => {
    const acl = (
      await db.query(`select p.prosecdef as definer, p.proconfig as config,
      has_function_privilege('anon',p.oid,'execute') as anon,
      has_function_privilege('authenticated',p.oid,'execute') as authenticated,
      has_function_privilege('service_role',p.oid,'execute') as service
      from pg_proc p where p.oid='public.open_regular_packs(integer)'::regprocedure`)
    ).rows[0];
    assert.equal(acl.definer, false);
    assert.ok(acl.config.includes('search_path=""'));
    assert.equal(acl.anon, false);
    assert.equal(acl.authenticated, true);
    assert.equal(acl.service, false);
    for (const role of ["anon", "service_role"]) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(draw(1), /permission denied/);
    }
    await login("");
    await assert.rejects(draw(1), /AUTH_REQUIRED/);
    await login();
  });
  await t.test(
    "invalid quantities and insufficient reserve change nothing",
    async () => {
      await resetReserve();
      const before = await snapshot();
      for (const count of [null, -1, 0, 2, 6, 11, 2147483647])
        await assert.rejects(draw(count), /INVALID_PACK_COUNT/);
      await assert.rejects(draw(10), /INSUFFICIENT_PACKS/);
      assert.deepEqual(await snapshot(), before);
    }
  );
  await t.test(
    "Basic opens exactly five packs, not five cards, with only its own rewards",
    async () => {
      const before = await snapshot();
      const cards = await draw(5);
      assert.equal(cards.length, 25);
      assert.equal(new Set(cards.map(card => card.instanceId)).size, 25);
      assert.ok(
        cards.every(
          card =>
            card.liveFranchise === true && card.catalogueImage === card.image
        )
      );
      const after = await snapshot();
      assert.equal(after.cards.length, 25);
      assert.ok(after.cards.every(card => card.user_id === player));
      assert.equal(
        after.stats.find(row => row.user_id === player).regular_packs_opened,
        5
      );
      assert.deepEqual(
        after.profiles.find(row => row.user_id === other),
        before.profiles.find(row => row.user_id === other)
      );
      assert.equal(
        (await db.query("select public.get_regular_pack_status() value"))
          .rows[0].value.available,
        0
      );
      await assert.rejects(draw(1), /INSUFFICIENT_PACKS/);
    }
  );
  await t.test(
    "ten packs can use the existing Basic reserve plus referral bonus",
    async () => {
      await resetReserve(5);
      const cards = await draw(10);
      assert.equal(cards.length, 50);
      assert.equal(new Set(cards.map(card => card.instanceId)).size, 50);
      const status = (
        await db.query("select public.get_regular_pack_status() value")
      ).rows[0].value;
      assert.equal(status.available, 0);
      assert.equal(status.bonus, 0);
      assert.equal(status.reserve, 0);
      const after = await snapshot();
      assert.equal(after.cards.length, 75);
      assert.equal(
        after.stats.find(row => row.user_id === player).regular_packs_opened,
        15
      );
    }
  );
  await t.test(
    "verified Pro reserve opens exactly ten packs, without changing the tier or drop rules",
    async () => {
      await db.exec("reset role");
      const scope = "test:acct_batch:price_batch";
      await db.query(
        "insert into public.billing_accounts(user_id,scope,active,status,period_end,verified_at) values($1,$2,true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
        [player, scope]
      );
      await db.query("select public.billing_set_entitlement_scope($1,true)", [
        scope
      ]);
      await resetReserve();
      const status = (
        await db.query("select public.get_regular_pack_status() value")
      ).rows[0].value;
      assert.equal(status.maximum, 10);
      assert.equal(status.available, 10);
      assert.equal((await draw(10)).length, 50);
      const after = await snapshot();
      assert.equal(after.cards.length, 125);
      assert.equal(
        after.stats.find(row => row.user_id === player).regular_packs_opened,
        25
      );
    }
  );
  await t.test(
    "a failure in the second pack rolls back the first pack, all quotas, achievements and notifications",
    async () => {
      await resetReserve();
      await db.exec("reset role");
      await db.exec(`create function public.batch_test_fail() returns trigger language plpgsql as $$
      begin
        if (select count(*) from public.user_cards where user_id='${player}') >= 130 then
          raise exception 'BATCH_TEST_FAILURE';
        end if;
        return new;
      end $$;
      create trigger batch_test_fail before insert on public.user_cards for each row execute function public.batch_test_fail();`);
      await login();
      const before = await snapshot();
      await assert.rejects(draw(5), /BATCH_TEST_FAILURE/);
      assert.deepEqual(await snapshot(), before);
      await db.exec(
        "reset role; drop trigger batch_test_fail on public.user_cards; drop function public.batch_test_fail()"
      );
      await login();
      assert.equal((await draw(1)).length, 5);
    }
  );
});
