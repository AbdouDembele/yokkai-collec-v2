import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("friend acceptance notifies only the requester, exactly once per acceptance, with read/block/push protections", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const ids = Array.from(
    { length: 6 },
    (_, n) => `83000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`
  );
  const [alice, bob, carol, dave, erin, frank] = ids;
  for (const [n, id] of ids.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `AcceptFriend${n + 1}` })]
    );
  const as = async (user, sql, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? ""
    ]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec(
        "reset role;select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const send = async (from, to) =>
    (await as(from, "select public.send_friend_request($1) id", [to]))[0].id;
  const respond = (user, id, accepted = true) =>
    as(user, "select public.respond_friend_request($1,$2) value", [
      id,
      accepted
    ]);
  const list = async user =>
    (await as(user, "select public.list_notifications() value"))[0].value;
  const accepted = async user =>
    (await list(user)).filter(n => n.type === "friend_request_accepted");
  const request = await send(alice, bob);
  await assert.rejects(respond(alice, request), /ACTION_UNAVAILABLE/);
  await assert.rejects(respond(carol, request), /ACTION_UNAVAILABLE/);
  await assert.rejects(respond(null, request), /AUTH_REQUIRED/);
  assert.deepEqual(await accepted(alice), []);
  await respond(bob, request);
  const [note] = await accepted(alice);
  assert.ok(note);
  assert.equal(note.referenceId, bob);
  assert.equal(note.actorPseudo, "AcceptFriend2");
  assert.equal(note.readAt, null);
  assert.equal((await accepted(alice)).length, 1);
  assert.deepEqual(
    await list(bob),
    [],
    "The accepted pending-request notification is removed, without notifying the accepter of their own action"
  );
  assert.deepEqual(await list(carol), []);
  await as(alice, "select public.mark_notification_read($1)", [note.id]);
  const read = (await accepted(alice))[0].readAt;
  assert.ok(read);
  await assert.rejects(respond(bob, request), /ACTION_UNAVAILABLE/);
  assert.equal(
    (await accepted(alice))[0].readAt,
    read,
    "An acceptance retry cannot reactivate a read notification"
  );
  await db.exec("set role service_role");
  const pushed = (
    await db.query(
      "select public.get_push_notification($1,$2::timestamptz) value",
      [note.id, note.createdAt]
    )
  ).rows[0].value;
  await db.exec("reset role");
  assert.equal(pushed.notification.actorPseudo, "AcceptFriend2");
  assert.equal(pushed.notification.referenceId, bob);
  await as(alice, "select public.remove_friend($1)", [bob]);
  assert.equal(
    (await accepted(alice))[0].actorPseudo,
    "AcceptFriend2",
    "The actor survives removal of the friendship row"
  );
  const again = await send(alice, bob);
  await respond(bob, again);
  const renewed = await accepted(alice);
  assert.equal(renewed.length, 1);
  assert.equal(renewed[0].id, note.id);
  assert.equal(renewed[0].readAt, null);
  await as(alice, "select public.block_user($1)", [bob]);
  assert.deepEqual(
    await accepted(alice),
    [],
    "Blocking the accepter clears/hides the social notification"
  );
  const declined = await send(carol, dave);
  await respond(dave, declined, false);
  assert.deepEqual(await accepted(carol), []);
  const cancelled = await send(erin, frank);
  await as(erin, "select public.cancel_friend_request($1)", [frank]);
  await assert.rejects(respond(frank, cancelled), /ACTION_UNAVAILABLE/);
  assert.deepEqual(await accepted(erin), []);
  const banned = await send(frank, erin);
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [erin]
  );
  await assert.rejects(respond(erin, banned), /ACCOUNT_BANNED/);
  assert.deepEqual(await accepted(frank), []);
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select public.respond_friend_request($1,true)", [banned]),
    /permission denied/
  );
  await db.exec("reset role");
});
