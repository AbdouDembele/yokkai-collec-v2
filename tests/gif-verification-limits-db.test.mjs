import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

// Follow-up to #568: the GIF verification route spends the shared GIPHY quota,
// so each call first runs the ban check and a durable per-player limit.
test("GIF verification: ban check, 20/min and 200/day limits, fresh rating reuse", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const [player, banned] = [
    "37920000-0000-4000-8000-000000000001",
    "37920000-0000-4000-8000-000000000002"
  ];
  for (const [id, pseudo] of [
    [player, "VerifyPlayer"],
    [banned, "VerifyBanned"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    banned
  ]);
  await db.exec(
    "insert into public.giphy_gif_ratings(gif_id,rating,verified_at) values ('fresh','pg',now()),('stale','g',now()-interval '8 days')"
  );
  const as = async (role, user = "") => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const consume = async id =>
    (await db.query("select public.consume_gif_verification($1) cached", [id]))
      .rows[0].cached;

  await as("anon");
  await assert.rejects(consume("fresh"), /permission denied/);
  await as("authenticated", banned);
  await assert.rejects(consume("fresh"), /ACCOUNT_BANNED/);
  await as("authenticated", player);
  await assert.rejects(
    db.query("select 1 from public.gif_verification_limits"),
    /permission denied/
  );
  await assert.rejects(consume("../x"), /GIF_INVALID/);
  assert.equal(await consume("fresh"), "pg", "verified in the last 7 days");
  assert.equal(await consume("stale"), null, "older ratings are re-checked");
  assert.equal(await consume("unknown"), null);
  for (let i = 3; i < 20; i++) await consume("unknown");
  await assert.rejects(consume("unknown"), /GIF_VERIFY_RATE_LIMITED/);

  // A new minute admits again, until the daily cap.
  await as("postgres");
  await db.exec(
    "update public.gif_verification_limits set minute_started_at=minute_started_at-interval '61 seconds'"
  );
  await as("authenticated", player);
  await consume("unknown");
  await as("postgres");
  await db.exec(
    "update public.gif_verification_limits set minute_started_at=minute_started_at-interval '61 seconds', day_requests=200"
  );
  await as("authenticated", player);
  await assert.rejects(consume("unknown"), /GIF_VERIFY_RATE_LIMITED/);
  await as("postgres");
  await db.exec(
    "update public.gif_verification_limits set day_started_at=day_started_at-interval '25 hours'"
  );
  await as("authenticated", player);
  await consume("unknown");
  await as("postgres");
  assert.deepEqual(
    (
      await db.query(
        "select count(*)::int rows, max(day_requests) today from public.gif_verification_limits"
      )
    ).rows[0],
    { rows: 1, today: 1 },
    "one row per player, reset by the new day window"
  );
});
