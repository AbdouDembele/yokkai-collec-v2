import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const directory = new URL("../supabase/migrations/", import.meta.url);
const migration = "20261028200000_basic_regular_pack_five_minutes.sql";
const id = n => `c5800000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("five-minute Regular Packs preserve progress, cap Basic at five and every verified Pro at ten", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(name => name.endsWith(".sql") && name < migration)
      .sort()
  });
  t.after(() => db.close());
  for (let n = 1; n <= 6; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id(n), JSON.stringify({ pseudo: `FiveMinute${n}` })]
    );
  const rpc = async (n, sql, params = []) => {
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id(n)
      ]);
      return (await db.query(sql, params)).rows[0]?.value;
    } finally {
      await db.exec("reset role");
    }
  };
  const status = n => rpc(n, "select public.get_regular_pack_status() value");
  const grant = async (n, enabled) => {
    await db.exec("set role service_role");
    try {
      await db.query("select public.billing_set_manual_pro_access($1,$2,$3)", [
        id(n),
        enabled,
        enabled ? "Five minute reserve regression" : null
      ]);
    } finally {
      await db.exec("reset role");
    }
  };
  const deadline = async n =>
    (
      await db.query(
        "select next_regular_pack_at::text value from public.user_profiles where user_id=$1",
        [id(n)]
      )
    ).rows[0].value;
  const setDeadline = async (n, interval) =>
    db.query(
      "update public.user_profiles set next_regular_pack_at=clock_timestamp()+$2::interval where user_id=$1",
      [id(n), interval]
    );

  assert.equal(
    (await status(1)).refillSeconds,
    600,
    "fixture starts with the production rule being replaced"
  );
  await grant(4, true);
  await setDeadline(1, "5 minutes"); // Half a legacy cooldown remains.
  await setDeadline(2, "-15 minutes"); // Two earned packs + half the next refill.
  await setDeadline(3, "-1 year"); // Full Basic reserve, never more than five.
  await setDeadline(4, "-45 minutes"); // Full lifetime Pro reserve must stay ten.
  await db.query(
    "update public.user_profiles set bonus_regular_packs=7,next_decision_pack_at='2090-01-01' where user_id=$1",
    [id(2)]
  );
  await db.query(
    "insert into public.decision_packs(user_id,status) values($1,'claimed')",
    [id(2)]
  );
  const proBefore = await deadline(4);
  const decisionBefore = (
    await db.query(
      "select next_decision_pack_at::text value from public.user_profiles where user_id=$1",
      [id(2)]
    )
  ).rows[0].value;
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));

  await t.test(
    "migration halves remaining time and preserves earned stock, bonuses and daily history",
    async () => {
      const half = await status(1);
      assert.equal(half.refillSeconds, 300);
      assert.equal(half.maximum, 5);
      assert.equal(half.reserve, 0);
      assert.ok(
        half.nextPackAt - half.serverNow > 145000 &&
          half.nextPackAt - half.serverNow <= 150000
      );
      const earned = await status(2);
      assert.equal(earned.reserve, 2);
      assert.equal(earned.bonus, 7);
      assert.equal(
        earned.available,
        9,
        "bonus packs remain separate from the timed five-pack cap"
      );
      assert.ok(
        earned.nextPackAt - earned.serverNow > 145000 &&
          earned.nextPackAt - earned.serverNow <= 150000
      );
      assert.equal((await status(3)).reserve, 5);
      assert.equal((await status(3)).nextPackAt, null);
      assert.equal(
        await deadline(4),
        proBefore,
        "existing Pro timers do not move at deployment"
      );
      assert.equal((await status(4)).reserve, 10);
      assert.equal((await status(4)).maximum, 10);
      assert.equal(
        (
          await db.query(
            "select next_decision_pack_at::text value from public.user_profiles where user_id=$1",
            [id(2)]
          )
        ).rows[0].value,
        decisionBefore
      );
      assert.equal(
        (await rpc(2, "select public.get_decision_pack_status() value"))
          .remaining,
        0,
        "the existing daily Decision Pack consumption is preserved"
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int value from public.user_profiles where regular_pack_interval_seconds<>300"
          )
        ).rows[0].value,
        0
      );
      await db.query(
        'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"NewFiveMinute"}\')',
        [id(7)]
      );
      assert.equal(
        (await status(7)).refillSeconds,
        300,
        "new accounts inherit the five-minute default"
      );
    }
  );

  await t.test(
    "manual lifetime, expiring and Stripe Pro have the same reserve without moving the timer",
    async () => {
      await setDeadline(5, "-20 minutes");
      const before = await deadline(5);
      await grant(5, true);
      assert.equal(await deadline(5), before);
      assert.equal(
        (await status(5)).reserve,
        5,
        "activation does not mint five extra packs"
      );
      assert.equal((await status(5)).maximum, 10);
      await setDeadline(5, "-45 minutes");
      assert.equal((await status(5)).reserve, 10);
      await db.query(
        "update public.pro_access_grants set expires_at=clock_timestamp()-interval '1 second' where user_id=$1",
        [id(5)]
      );
      const expired = await status(5);
      assert.equal(expired.reserve, 5);
      assert.equal(expired.maximum, 5);
      assert.equal(expired.refillSeconds, 300);
      await grant(5, false);
      await setDeadline(5, "2 minutes");
      const waiting = await deadline(5);
      for (let n = 0; n < 3; n++) {
        await grant(5, true);
        await grant(5, false);
      }
      assert.equal(
        await deadline(5),
        waiting,
        "repeated tier changes neither reset nor accelerate recharge"
      );

      const scope = "test:acct_fivemin:price_fivemin";
      await db.query("select public.billing_set_entitlement_scope($1,true)", [
        scope
      ]);
      await db.query(
        "insert into public.billing_accounts(user_id,scope,active,status,period_end,verified_at) values($1,$2,true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
        [id(6), scope]
      );
      await setDeadline(6, "-45 minutes");
      const paid = await status(6);
      assert.equal(paid.maximum, 10);
      assert.equal(paid.reserve, 10);
      assert.equal(paid.refillSeconds, 300);
      await db.query(
        "update public.billing_accounts set risk_hold=true where user_id=$1",
        [id(6)]
      );
      const revoked = await status(6);
      assert.equal(revoked.maximum, 5);
      assert.equal(revoked.refillSeconds, 300);
    }
  );

  await t.test(
    "single and batch openings exhaust the capped reserve and the next pack refills in five minutes",
    async () => {
      for (const rarity of ["C", "R", "SR", "SSR", "LR"])
        await db.query(
          "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','FiveMinute',$2,'https://example.test/card.png','test')",
          [`five-${rarity}`, rarity]
        );
      assert.equal(
        (await rpc(3, "select public.open_regular_packs(5) value")).length,
        25
      );
      const empty = await status(3);
      assert.equal(empty.reserve, 0);
      assert.ok(
        empty.nextPackAt - empty.serverNow > 295000 &&
          empty.nextPackAt - empty.serverNow <= 300000
      );
      await assert.rejects(
        rpc(3, "select public.open_regular_pack() value"),
        /PACK_NOT_READY/
      );
      await setDeadline(3, "-1 second");
      assert.equal((await status(3)).reserve, 1);
      assert.equal(
        (await rpc(3, "select public.open_regular_pack() value")).length,
        5
      );
      assert.equal((await status(3)).reserve, 0);
      assert.equal(
        (await rpc(4, "select public.open_regular_packs(10) value")).length,
        50
      );
      const proEmpty = await status(4);
      assert.equal(proEmpty.reserve, 0);
      assert.ok(
        proEmpty.nextPackAt - proEmpty.serverNow > 295000 &&
          proEmpty.nextPackAt - proEmpty.serverNow <= 300000
      );
      assert.equal(
        (await rpc(2, "select public.open_regular_pack() value")).length,
        5
      );
      const bonus = await status(2);
      assert.equal(bonus.bonus, 6);
      assert.equal(
        bonus.reserve,
        2,
        "opening a bonus does not consume the timed reserve"
      );
    }
  );

  await t.test(
    "lazy legacy conversion and server-only timing ACLs remain enforced",
    async () => {
      await db.query(
        "update public.user_profiles set regular_pack_interval_seconds=600,next_regular_pack_at=clock_timestamp()+interval '4 minutes' where user_id=$1",
        [id(1)]
      );
      const converted = await status(1);
      assert.equal(converted.refillSeconds, 300);
      assert.ok(
        converted.nextPackAt - converted.serverNow > 115000 &&
          converted.nextPackAt - converted.serverNow <= 120000
      );
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(
            db.query("select public.billing_sync_pack_timing($1)", [id(1)]),
            /permission denied/
          );
        } finally {
          await db.exec("reset role");
        }
      }
      await assert.rejects(
        rpc(
          1,
          "update public.user_profiles set regular_pack_interval_seconds=600 where user_id=$1",
          [id(1)]
        ),
        /permission denied/
      );
    }
  );
});
