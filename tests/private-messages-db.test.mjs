import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";
const outsider = "10000000-0000-4000-8000-000000000003";

test("private messages: real SQL enforces identity, accepted friendship, blocking, pagination and retry safety", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"MessageAlice"}\'),($2,\'{"pseudo":"MessageBob"}\'),($3,\'{"pseudo":"MessageOutsider"}\')',
    [alice, bob, outsider]
  );
  await db.query(
    "insert into public.user_profiles(user_id,pseudo) values ($1,'MessageAlice'),($2,'MessageBob'),($3,'MessageOutsider') on conflict(user_id) do update set pseudo=excluded.pseudo",
    [alice, bob, outsider]
  );
  const as = async (user, sql, args = [], role = "authenticated") => {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? ""
    ]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec("reset role");
      await db.exec("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const list = async (
    user,
    friend,
    before = null,
    beforeId = null,
    limit = 40
  ) =>
    (
      await as(user, "select public.get_private_messages($1,$2,$3,$4) value", [
        friend,
        before,
        beforeId,
        limit
      ])
    )[0].value;
  const send = async (user, friend, body, id = crypto.randomUUID()) =>
    (
      await as(user, "select public.send_private_message($1,$2,$3) value", [
        friend,
        body,
        id
      ])
    )[0].value;
  await t.test(
    "RPCs and the private table are closed to anonymous and direct authenticated access",
    async () => {
      await assert.rejects(
        as(null, "select public.get_private_messages($1)", [bob], "anon"),
        /permission denied/
      );
      await assert.rejects(
        as(
          null,
          "select public.send_private_message($1,'secret',$2)",
          [bob, crypto.randomUUID()],
          "anon"
        ),
        /permission denied/
      );
      await assert.rejects(list(null, bob), /AUTH_REQUIRED/);
      for (const role of ["anon", "authenticated"]) {
        await assert.rejects(
          as(alice, "select * from public.private_messages", [], role),
          /permission denied/
        );
        await assert.rejects(
          as(
            alice,
            "insert into public.private_messages(id,sender_id,recipient_id,body) values($1,$2,$3,'spoofed')",
            [crypto.randomUUID(), bob, alice],
            role
          ),
          /permission denied/
        );
      }
      await assert.rejects(
        as(alice, "select public.private_messaging_allowed($1,$2)", [
          bob,
          outsider
        ]),
        /permission denied/
      );
      assert.equal(
        (
          await db.query(
            "select relrowsecurity from pg_class where oid='public.private_messages'::regclass"
          )
        ).rows[0].relrowsecurity,
        true
      );
    }
  );
  await t.test(
    "strangers, self and pending invitations cannot read or send",
    async () => {
      await assert.rejects(send(alice, bob, "Hello"), /MESSAGES_UNAVAILABLE/);
      await db.query(
        "insert into public.friendships(user_id,friend_id,status) values($1,$2,'pending')",
        [bob, alice]
      );
      await assert.rejects(list(alice, bob), /MESSAGES_UNAVAILABLE/);
      await assert.rejects(send(alice, bob, "Hello"), /MESSAGES_UNAVAILABLE/);
      await assert.rejects(send(alice, alice, "Self"), /MESSAGES_UNAVAILABLE/);
      await db.exec("update public.friendships set status='accepted'");
    }
  );
  let first;
  await t.test(
    "accepted friends can exchange literal text, with server-owned identity and idempotent sends",
    async () => {
      const id = crypto.randomUUID();
      first = await send(
        alice,
        bob,
        "  Hello <script>alert(1)</script> 👋  ",
        id
      );
      assert.equal(first.senderId, alice);
      assert.equal(first.recipientId, bob);
      assert.equal(first.text, "Hello <script>alert(1)</script> 👋");
      assert.equal((await send(alice, bob, first.text, id)).id, id);
      assert.equal((await list(bob, alice)).items.length, 1);
      assert.equal((await list(bob, alice)).viewerId, bob);
      await assert.rejects(send(alice, bob, "changed", id), /MESSAGE_CONFLICT/);
      await assert.rejects(send(bob, alice, "reuse", id), /MESSAGE_CONFLICT/);
      await assert.rejects(list(outsider, alice), /MESSAGES_UNAVAILABLE/);
      await assert.rejects(
        send(alice, bob, "too fast"),
        /MESSAGE_RATE_LIMITED/
      );
      const reply = await send(bob, alice, "Hello back!");
      assert.equal(reply.senderId, bob);
    }
  );
  await t.test(
    "invalid input and cursor are rejected without creating rows",
    async () => {
      for (const body of ["", " \n\t ", "x".repeat(2001), null])
        await assert.rejects(send(alice, bob, body), /MESSAGE_INVALID/);
      await assert.rejects(
        list(alice, bob, first.createdAt, null),
        /MESSAGE_CURSOR_INVALID/
      );
    }
  );
  await t.test(
    "keyset pagination covers identical timestamps once, in chronological order",
    async () => {
      const at = "2026-01-01T00:00:00Z";
      for (let index = 0; index < 55; index++)
        await db.query(
          "insert into public.private_messages(id,sender_id,recipient_id,body,created_at) values($1,$2,$3,$4,$5)",
          [crypto.randomUUID(), alice, bob, `history-${index}`, at]
        );
      const newest = await list(bob, alice);
      assert.equal(newest.items.length, 40);
      assert.ok(newest.next);
      const older = await list(bob, alice, newest.next.at, newest.next.id);
      assert.equal(older.items.length, 17);
      assert.equal(older.next, null);
      assert.equal(
        new Set([...newest.items, ...older.items].map(message => message.id))
          .size,
        57
      );
      assert.deepEqual(newest.items.map(message => message.text).slice(-2), [
        first.text,
        "Hello back!"
      ]);
      assert.equal(
        (await list(alice, bob, null, null, 100000)).items.length,
        57
      );
    }
  );
  await t.test(
    "the minute rate limit applies across recipients even after the per-second delay",
    async () => {
      await db.query(
        "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
        [alice, outsider]
      );
      await db.query(
        "update public.private_messages set created_at=now()-interval '2 minutes' where sender_id=$1",
        [alice]
      );
      const ids = [];
      for (let index = 0; index < 30; index++) {
        const id = crypto.randomUUID();
        ids.push(id);
        await db.query(
          "insert into public.private_messages(id,sender_id,recipient_id,body,created_at) values($1,$2,$3,'rate limit fixture',clock_timestamp()-interval '2 seconds')",
          [id, alice, bob]
        );
      }
      await assert.rejects(
        send(alice, outsider, "another recipient"),
        /MESSAGE_RATE_LIMITED/
      );
      await db.query(
        "delete from public.private_messages where id=any($1::uuid[])",
        [ids]
      );
      await db.query("delete from public.friendships where friend_id=$1", [
        outsider
      ]);
    }
  );
  await t.test(
    "a block in either direction, removal, bans and deletion fences revoke both read and send",
    async () => {
      for (const [blocker, blocked] of [
        [alice, bob],
        [bob, alice]
      ]) {
        await db.query(
          "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
          [blocker, blocked]
        );
        for (const [viewer, friend] of [
          [alice, bob],
          [bob, alice]
        ]) {
          await assert.rejects(list(viewer, friend), /MESSAGES_UNAVAILABLE/);
          await assert.rejects(
            send(viewer, friend, "blocked"),
            /MESSAGES_UNAVAILABLE/
          );
        }
        await db.exec("delete from public.user_blocks");
      }
      await db.exec("update public.friendships set status='pending'");
      await assert.rejects(list(alice, bob), /MESSAGES_UNAVAILABLE/);
      await db.exec("update public.friendships set status='accepted'");
      await db.query(
        "update auth.users set banned_until='infinity' where id=$1",
        [bob]
      );
      await assert.rejects(list(alice, bob), /MESSAGES_UNAVAILABLE/);
      await db.exec("update auth.users set banned_until=null");
      await db.query(
        "insert into public.account_deletion_log(user_id) values($1)",
        [bob]
      );
      await assert.rejects(list(alice, bob), /MESSAGES_UNAVAILABLE/);
      await assert.rejects(send(alice, bob, "deleted"), /MESSAGES_UNAVAILABLE/);
      await db.exec("delete from public.account_deletion_log");
      await db.query("delete from auth.users where id=$1", [bob]);
      assert.equal(
        (
          await db.query(
            "select count(*)::integer count from public.private_messages"
          )
        ).rows[0].count,
        0
      );
    }
  );
});
