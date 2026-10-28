import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("unread activity is owner-scoped, monotonic, independent of the bell and fenced by social access", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const alice = "50000000-0000-4000-8000-000000000001";
  const bob = "50000000-0000-4000-8000-000000000002";
  const other = "50000000-0000-4000-8000-000000000003";
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  for (const [id, pseudo] of [
    [alice, "UnreadAlice"],
    [bob, "UnreadBob"],
    [other, "UnreadOther"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted'),($3,$2,'pending')",
    [alice, bob, other]
  );
  const as = async (user, sql, args = [], role = "authenticated") => {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? ""
    ]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const summary = async user =>
    (await as(user, "select public.get_social_unread() value"))[0].value;
  const mark = (user, friend, id) =>
    as(user, "select public.mark_private_messages_read($1,$2)", [friend, id]);
  const send = async (user, friend) => {
    // Fixtures bypass rate limiting by aging prior sends, never by changing RPCs.
    await db.exec(
      "update public.private_messages set created_at=created_at-interval '2 seconds'"
    );
    return (
      await as(
        user,
        "select public.send_private_message($1,'private body',$2) value",
        [friend, crypto.randomUUID()]
      )
    )[0].value;
  };
  await assert.rejects(
    as(null, "select public.get_social_unread()", [], "anon"),
    /permission denied/
  );
  await assert.rejects(
    as(
      null,
      "select public.mark_private_messages_read($1,$2)",
      [alice, crypto.randomUUID()],
      "anon"
    ),
    /permission denied/
  );
  await assert.rejects(summary(null), /AUTH_REQUIRED/);
  for (const role of ["anon", "authenticated"]) {
    for (const sql of [
      "select * from public.private_message_reads",
      "insert into public.private_message_reads values(null,null,1)",
      "select nextval('public.private_message_read_order_seq')"
    ])
      await assert.rejects(as(bob, sql, [], role), /permission denied/);
  }
  assert.equal((await summary(bob)).requestCount, 1);
  assert.equal((await summary(alice)).requestCount, 0);
  const first = await send(alice, bob);
  const second = await send(alice, bob);
  const reply = await send(bob, alice);
  let unread = await summary(bob);
  assert.equal(unread.viewerId, bob);
  assert.equal(unread.messageCount, 2);
  assert.deepEqual(unread.messages, [{ friendId: alice, count: 2 }]);
  assert.ok(!JSON.stringify(unread).includes("private body"));
  assert.equal((await summary(other)).messageCount, 0);
  const page = (
    await as(bob, "select public.get_private_messages($1) value", [alice])
  )[0].value;
  assert.equal(page.readThroughId, second.id);
  assert.equal(
    (await summary(bob)).messageCount,
    2,
    "Fetching alone is not an acknowledgement"
  );
  const notes = (await as(bob, "select public.list_notifications() value"))[0]
    .value;
  for (const note of notes)
    await as(bob, "select public.mark_notification_read($1)", [note.id]);
  assert.equal(
    (await summary(bob)).messageCount,
    2,
    "The bell must not clear conversation unread state"
  );
  await assert.rejects(mark(bob, alice, reply.id), /MESSAGE_READ_INVALID/);
  await assert.rejects(mark(alice, bob, second.id), /MESSAGE_READ_INVALID/);
  await assert.rejects(mark(other, alice, second.id), /MESSAGES_UNAVAILABLE/);
  await mark(bob, alice, first.id);
  assert.equal((await summary(bob)).messageCount, 1);
  await mark(bob, alice, second.id);
  await mark(bob, alice, first.id);
  assert.equal(
    (await summary(bob)).messageCount,
    0,
    "An older tab cannot move the watermark backwards"
  );
  const third = await send(alice, bob);
  await mark(bob, alice, page.readThroughId);
  assert.equal(
    (await summary(bob)).messageCount,
    1,
    "Arrival after a fetched page remains unread"
  );
  // More than the notification feed's cap must be counted; raw fixture inserts
  // have the same default delivery sequence as the protected send operation.
  await db.query(
    "insert into public.private_messages(id,sender_id,recipient_id,body) select gen_random_uuid(),$1,$2,'older unread' from generate_series(1,45)",
    [alice, bob]
  );
  assert.equal((await summary(bob)).messageCount, 46);
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [bob, alice]
  );
  assert.equal((await summary(bob)).messageCount, 0);
  await assert.rejects(mark(bob, alice, third.id), /MESSAGES_UNAVAILABLE/);
  await db.exec("delete from public.user_blocks");
  assert.equal((await summary(bob)).messageCount, 46);
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    other
  ]);
  assert.equal((await summary(bob)).requestCount, 0);
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    bob
  ]);
  assert.equal((await summary(bob)).messageCount, 0);
  await assert.rejects(mark(bob, alice, third.id), /ACCOUNT_BANNED/);
  await db.exec(
    "update auth.users set banned_until=null; update public.friendships set status='pending'"
  );
  assert.equal((await summary(bob)).messageCount, 0);
  await db.exec("update public.friendships set status='accepted'");
  assert.equal((await summary(bob)).requestCount, 0);
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [alice]
  );
  assert.equal((await summary(bob)).messageCount, 0);
  await assert.rejects(mark(bob, alice, third.id), /MESSAGES_UNAVAILABLE/);
  await db.query("delete from public.account_deletion_log where user_id=$1", [
    alice
  ]);
  await db.query("delete from auth.users where id=$1", [alice]);
  assert.equal(
    (await db.query("select count(*)::int n from public.private_message_reads"))
      .rows[0].n,
    0,
    "Account deletion cascades read markers"
  );
});
