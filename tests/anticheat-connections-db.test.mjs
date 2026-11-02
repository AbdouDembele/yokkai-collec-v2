import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
test("admin connection context names the related accounts, browser corroboration and date without exposing fingerprints", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column banned_until timestamptz");
  const ids = Array.from(
    { length: 5 },
    (_, i) => `ac610000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  const [admin, player, housemate, smurf, stale] = ids;
  for (const [i, id] of ids.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2)",
      [id, JSON.stringify({ pseudo: `Connection${i}` })]
    );
  await db.query("insert into public.admin_users(user_id)values($1)", [admin]);
  const network = `v1:${"a".repeat(64)}`,
    browser = `v1:${"b".repeat(64)}`;
  for (const id of [player, housemate, smurf])
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id)values($1,$2)",
      [network, id]
    );
  await db.query(
    "insert into public.anticheat_network_observations(network_identity,user_id,first_seen_at,last_seen_at)values($1,$2,now()-interval '9 days',now()-interval '8 days')",
    [network, stale]
  );
  for (const id of [player, smurf])
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id)values($1,$2)",
      [browser, id]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')",
    [player, smurf]
  );
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_karas,status)values($1,$2,1,'accepted')",
    [player, smurf]
  );
  const read = async (user, list) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          "select public.admin_list_anticheat_connections($1)value",
          [list]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  await assert.rejects(read(player, [player]), /ADMIN_REQUIRED/);
  await assert.rejects(
    read(admin, Array(31).fill(player)),
    /INVALID_CONNECTION_USERS/
  );
  const result = await read(admin, [player, stale]);
  assert.equal(result[player].count, 2);
  assert.equal(result[stale].count, 0);
  const same = result[player].accounts.find(a => a.userId === smurf),
    house = result[player].accounts.find(a => a.userId === housemate);
  assert.equal(same.pseudo, "Connection3");
  assert.equal(same.sharedBrowser, true);
  assert.equal(same.acceptedTrades, 1);
  assert.ok(Number.isFinite(Date.parse(same.lastSharedAt)));
  assert.equal(house.sharedBrowser, false);
  assert.equal(house.acceptedTrades, 0);
  assert.doesNotMatch(
    JSON.stringify(result),
    /network_identity|device_identity|v1:|aaaaaaaa|bbbbbbbb/
  );
});
