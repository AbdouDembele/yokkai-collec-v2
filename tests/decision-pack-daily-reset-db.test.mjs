import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = index =>
  `76000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

async function windowAt(db, at) {
  return (
    await db.query(
      `select extract(epoch from period_start)*1000 as start,
        extract(epoch from next_reset_at)*1000 as reset
      from public.decision_pack_daily_window($1::timestamptz)`,
      [at]
    )
  ).rows.map(row => ({
    start: Number(row.start),
    reset: Number(row.reset)
  }))[0];
}

async function rpc(db, user, sql, params = []) {
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    return (await db.query(sql, params)).rows[0]?.value;
  } finally {
    await db.exec("reset role");
  }
}

const status = (db, user) =>
  rpc(db, user, "select public.get_decision_pack_status() as value");
const open = (db, user) =>
  rpc(db, user, "select public.open_decision_pack() as value");
const keep = (db, user, choices) =>
  rpc(db, user, "select public.keep_decision_pack_card($1) as value", [
    choices[0].instanceId
  ]);

async function setPro(db, user, enabled) {
  await db.exec("set role service_role");
  try {
    await db.query("select public.billing_set_manual_pro_access($1,$2,$3)", [
      user,
      enabled,
      enabled ? "Daily Decision Pack test" : null
    ]);
  } finally {
    await db.exec("reset role");
  }
}

async function seedPlayer(db, index) {
  const user = player(index);
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
    [user, JSON.stringify({ pseudo: `DailyDecision${index}` })]
  );
  return user;
}

test("Decision daily windows are private and reset exactly at 20:00 Europe/Paris, including DST", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  const signature =
    "public.decision_pack_daily_window(timestamp with time zone)";
  for (const [role, allowed] of [
    ["public", false],
    ["anon", false],
    ["authenticated", false],
    ["service_role", true]
  ]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,$2,'EXECUTE') as allowed",
          [role, signature]
        )
      ).rows[0].allowed,
      allowed,
      `${role} access to the server-only time window helper`
    );
  }

  const before = {
    start: Date.parse("2026-10-18T18:00:00.000Z"),
    reset: Date.parse("2026-10-19T18:00:00.000Z")
  };
  const after = {
    start: before.reset,
    reset: Date.parse("2026-10-20T18:00:00.000Z")
  };
  for (const sessionZone of [
    "UTC",
    "Europe/Paris",
    "America/Los_Angeles",
    "Asia/Tokyo"
  ]) {
    await db.query("select set_config('TimeZone',$1,false)", [sessionZone]);
    assert.deepEqual(
      await windowAt(db, "2026-10-19T19:59:59.999+02:00"),
      before,
      `${sessionZone}: the final millisecond stays in the previous window`
    );
    assert.deepEqual(
      await windowAt(db, "2026-10-19T20:00:00.000+02:00"),
      after,
      `${sessionZone}: the reset instant belongs to the new window`
    );
    assert.deepEqual(
      await windowAt(db, "2026-10-19T20:00:00.001+02:00"),
      after,
      `${sessionZone}: the result must not depend on the SQL session zone`
    );
  }
  await db.exec("set timezone='UTC'");

  const spring = await windowAt(db, "2026-03-29T12:00:00Z");
  assert.deepEqual(spring, {
    start: Date.parse("2026-03-28T19:00:00Z"),
    reset: Date.parse("2026-03-29T18:00:00Z")
  });
  assert.equal((spring.reset - spring.start) / 3_600_000, 23);

  const autumn = await windowAt(db, "2026-10-25T12:00:00Z");
  assert.deepEqual(autumn, {
    start: Date.parse("2026-10-24T18:00:00Z"),
    reset: Date.parse("2026-10-25T19:00:00Z")
  });
  assert.equal((autumn.reset - autumn.start) / 3_600_000, 25);
  assert.deepEqual(await windowAt(db, "2026-12-10T20:00:00+01:00"), {
    start: Date.parse("2026-12-10T19:00:00Z"),
    reset: Date.parse("2026-12-11T19:00:00Z")
  });
});

test("Decision RPCs enforce shared daily Basic/Pro quotas without stacking or tier-change refills", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const rarity of ["SR", "SSR", "LR"])
    await db.query(
      `insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
      values($1,$1,'Anime/Manga','Daily Decision',$2,'https://example.test/card.png','test')`,
      [`daily-${rarity}`, rarity]
    );

  await t.test(
    "Basic gets one pack, and reopening its pending choices spends no extra credit",
    async () => {
      const user = await seedPlayer(db, 1);
      const initial = await status(db, user);
      assert.equal(initial.maximum, 1);
      assert.equal(initial.remaining, 1);
      assert.equal(initial.available, true);
      assert.deepEqual(initial.pending, []);
      assert.equal(initial.resetTimeZone, "Europe/Paris");
      assert.equal(initial.nextPackAt, initial.resetAt);
      assert.ok(initial.resetAt > initial.serverNow);
      assert.equal(
        initial.resetAt,
        (await windowAt(db, new Date(initial.serverNow).toISOString())).reset
      );

      const choices = await open(db, user);
      assert.equal(choices.length, 5);
      assert.deepEqual(await open(db, user), choices);
      const pending = await status(db, user);
      assert.equal(pending.remaining, 0);
      assert.equal(pending.maximum, 1);
      assert.equal(pending.available, false);
      assert.equal(pending.pending.length, 5);
      assert.equal(pending.nextPackAt, initial.resetAt);
      const created = Number(
        (
          await db.query(
            "select extract(epoch from created_at)*1000 as stamp from public.decision_packs where user_id=$1",
            [user]
          )
        ).rows[0].stamp
      );
      assert.ok(created >= initial.serverNow && created <= pending.serverNow);
      await keep(db, user, choices);
      const complete = await status(db, user);
      assert.equal(complete.remaining, 0);
      assert.equal(complete.available, false);
      assert.deepEqual(complete.pending, []);
      await assert.rejects(open(db, user), /DECISION_PACK_NOT_READY/);
      assert.equal(
        Number(
          (
            await db.query(
              "select count(*) as n from public.decision_packs where user_id=$1",
              [user]
            )
          ).rows[0].n
        ),
        1
      );
    }
  );

  await t.test(
    "Pro gets two separate choices immediately, never a third pack in the same window",
    async () => {
      const user = await seedPlayer(db, 2);
      await setPro(db, user, true);
      const initial = await status(db, user);
      assert.equal(initial.maximum, 2);
      assert.equal(initial.remaining, 2);
      assert.equal(initial.available, true);
      const first = await open(db, user);
      const firstPending = await status(db, user);
      assert.equal(firstPending.remaining, 1);
      assert.equal(firstPending.available, false);
      assert.deepEqual(await open(db, user), first);
      await keep(db, user, first);
      assert.equal((await status(db, user)).available, true);
      const second = await open(db, user);
      assert.equal(second.length, 5);
      assert.notEqual(second[0].instanceId, first[0].instanceId);
      await keep(db, user, second);
      const exhausted = await status(db, user);
      assert.equal(exhausted.remaining, 0);
      assert.equal(exhausted.maximum, 2);
      assert.equal(exhausted.available, false);
      assert.equal(exhausted.resetAt, initial.resetAt);
      await assert.rejects(open(db, user), /DECISION_PACK_NOT_READY/);
      assert.equal(
        Number(
          (
            await db.query(
              "select count(*) as n from public.decision_packs where user_id=$1",
              [user]
            )
          ).rows[0].n
        ),
        2
      );
    }
  );

  await t.test(
    "upgrades and downgrades keep the same consumed count and do not shift the reset",
    async () => {
      const user = await seedPlayer(db, 3);
      const first = await open(db, user);
      await keep(db, user, first);
      const exhausted = await status(db, user);
      assert.equal(exhausted.remaining, 0);
      await db.query(
        "update public.user_profiles set next_decision_pack_at='2090-01-01T00:00:00Z' where user_id=$1",
        [user]
      );
      const deadline = async () =>
        (
          await db.query(
            "select extract(epoch from next_decision_pack_at)*1000 as value from public.user_profiles where user_id=$1",
            [user]
          )
        ).rows[0].value;
      const legacyDeadline = await deadline();
      await setPro(db, user, true);
      assert.equal(await deadline(), legacyDeadline);
      const upgraded = await status(db, user);
      assert.equal(upgraded.maximum, 2);
      assert.equal(upgraded.remaining, 1);
      assert.equal(upgraded.available, true);
      assert.equal(upgraded.resetAt, exhausted.resetAt);
      assert.equal(await deadline(), legacyDeadline);
      const second = await open(db, user);
      await setPro(db, user, false);
      const downgraded = await status(db, user);
      assert.equal(downgraded.maximum, 1);
      assert.equal(downgraded.remaining, 0);
      assert.equal(downgraded.available, false);
      assert.equal(downgraded.pending.length, 5);
      assert.deepEqual(await open(db, user), second);
      await keep(db, user, second);
      assert.deepEqual((await status(db, user)).pending, []);
      await assert.rejects(open(db, user), /DECISION_PACK_NOT_READY/);
      await setPro(db, user, true);
      const upgradedAgain = await status(db, user);
      assert.equal(upgradedAgain.maximum, 2);
      assert.equal(upgradedAgain.remaining, 0);
      assert.equal(upgradedAgain.available, false);
      assert.equal(upgradedAgain.resetAt, exhausted.resetAt);
      await assert.rejects(open(db, user), /DECISION_PACK_NOT_READY/);
    }
  );

  await t.test(
    "old pending choices survive reset without consuming a new daily credit",
    async () => {
      const user = await seedPlayer(db, 4);
      const old = await open(db, user);
      const oldStamp = Number(
        (
          await db.query(
            `update public.decision_packs set created_at=(
        select period_start-interval '1 millisecond'
        from public.decision_pack_daily_window(clock_timestamp())
      ) where user_id=$1 returning extract(epoch from created_at)*1000 as stamp`,
            [user]
          )
        ).rows[0].stamp
      );
      const carried = await status(db, user);
      assert.equal(carried.remaining, 1);
      assert.equal(carried.maximum, 1);
      assert.equal(carried.available, false);
      assert.equal(carried.pending.length, 5);
      const reopened = await open(db, user);
      assert.deepEqual(
        reopened.map(choice => ({
          ...choice,
          obtainedAt: Date.parse(choice.obtainedAt)
        })),
        old.map(choice => ({ ...choice, obtainedAt: oldStamp }))
      );
      await keep(db, user, old);
      const resumed = await status(db, user);
      assert.equal(resumed.remaining, 1);
      assert.equal(resumed.available, true);
      const fresh = await open(db, user);
      assert.notEqual(fresh[0].instanceId, old[0].instanceId);
      await keep(db, user, fresh);
      assert.equal((await status(db, user)).remaining, 0);
      await assert.rejects(open(db, user), /DECISION_PACK_NOT_READY/);
    }
  );

  await t.test(
    "missed days never accumulate and only packs inside the half-open window consume quota",
    async () => {
      const user = await seedPlayer(db, 5);
      await db.query(
        `insert into public.decision_packs(user_id,status,created_at)
      select $1::uuid,'claimed',period_start-interval '1 millisecond'
      from public.decision_pack_daily_window(clock_timestamp())
      union all
      select $1::uuid,'claimed',period_start-interval '30 days'
      from public.decision_pack_daily_window(clock_timestamp())
      union all
      select $1::uuid,'claimed',next_reset_at
      from public.decision_pack_daily_window(clock_timestamp())`,
        [user]
      );
      await db.query(
        "update public.user_profiles set next_decision_pack_at=clock_timestamp()-interval '1 year' where user_id=$1",
        [user]
      );
      assert.equal((await status(db, user)).remaining, 1);
      await setPro(db, user, true);
      assert.equal((await status(db, user)).remaining, 2);
      const initial = await status(db, user);
      await db.query(
        `insert into public.decision_packs(user_id,status,created_at)
      select $1,'claimed',period_start
      from public.decision_pack_daily_window(clock_timestamp())`,
        [user]
      );
      const oneUsed = await status(db, user);
      assert.equal(oneUsed.remaining, 1);
      assert.equal(oneUsed.resetAt, initial.resetAt);
      assert.equal(oneUsed.available, true);
      const last = await open(db, user);
      await keep(db, user, last);
      assert.equal((await status(db, user)).remaining, 0);
      await assert.rejects(open(db, user), /DECISION_PACK_NOT_READY/);
    }
  );

  await t.test(
    "future legacy deadlines and client metadata cannot change server eligibility",
    async () => {
      const user = await seedPlayer(db, 6);
      await db.query(
        "update public.user_profiles set next_decision_pack_at='2090-01-01T00:00:00Z' where user_id=$1",
        [user]
      );
      await db.query(
        'update auth.users set raw_user_meta_data=raw_user_meta_data||\'{"isPro":true,"plan":"pro"}\'::jsonb where id=$1',
        [user]
      );
      const initial = await status(db, user);
      assert.equal(initial.maximum, 1);
      assert.equal(initial.remaining, 1);
      assert.equal(initial.available, true);
      assert.ok(initial.nextPackAt < Date.parse("2090-01-01T00:00:00Z"));
      const choices = await open(db, user);
      await keep(db, user, choices);
      await assert.rejects(open(db, user), /DECISION_PACK_NOT_READY/);
    }
  );

  await t.test(
    "status and opening require authentication, and the helper is not player-callable",
    async () => {
      await assert.rejects(status(db, ""), /AUTH_REQUIRED/);
      await assert.rejects(open(db, ""), /AUTH_REQUIRED/);
      await assert.rejects(
        rpc(
          db,
          player(1),
          "select public.decision_pack_daily_window(clock_timestamp()) as value"
        ),
        /permission denied/
      );
      await assert.rejects(
        rpc(
          db,
          player(1),
          "insert into public.decision_packs(user_id) values($1) returning id as value",
          [player(1)]
        ),
        /permission denied/
      );
    }
  );
});
