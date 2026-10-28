import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("private GIF messages retain conversation security and never allow gallery URLs", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // GIFs verified by the server route (#379 C2); unverified ones are refused.
  await db.exec(
    "insert into public.giphy_gif_ratings(gif_id,rating) values ('hello','g'),('other','pg'),('a','pg-13')"
  );
  const alice = "20000000-0000-4000-8000-000000000001";
  const bob = "20000000-0000-4000-8000-000000000002";
  const outsider = "20000000-0000-4000-8000-000000000003";
  const gif =
    "https://media0.giphy.com/media/v1.Y2lk-test/hello/giphy.gif?cid=example&rid=giphy.gif&ct=g";
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  for (const [id, pseudo] of [
    [alice, "GifAlice"],
    [bob, "GifBob"],
    [outsider, "GifOutsider"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  const as = async (id, sql, args = [], role = "authenticated") => {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? ""
    ]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const send = async (user, friend, text, url, id = crypto.randomUUID()) =>
    (
      await as(
        user,
        "select public.send_private_message_gif($1,$2,$3,$4) value",
        [friend, text, id, url]
      )
    )[0].value;
  await assert.rejects(
    as(
      null,
      "select public.send_private_message_gif($1,'',$2,$3)",
      [bob, crypto.randomUUID(), gif],
      "anon"
    ),
    /permission denied/
  );
  await assert.rejects(send(null, bob, "", gif), /AUTH_REQUIRED/);
  await assert.rejects(send(alice, bob, "", gif), /MESSAGES_UNAVAILABLE/);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [alice, bob]
  );
  await t.test(
    "GIF-only and captioned messages, identical retries, shared text rate limit",
    async () => {
      const id = crypto.randomUUID();
      const first = await send(alice, bob, "", gif, id);
      assert.equal(first.gifUrl, gif);
      assert.equal(first.text, "");
      assert.equal(first.senderId, alice);
      assert.deepEqual(await send(alice, bob, "", gif, id), first);
      await assert.rejects(
        send(alice, bob, "changed", gif, id),
        /MESSAGE_CONFLICT/
      );
      await assert.rejects(
        send(alice, bob, "", "https://i.giphy.com/media/other/giphy.gif", id),
        /MESSAGE_CONFLICT/
      );
      await assert.rejects(
        as(alice, "select public.send_private_message($1,'plain text',$2)", [
          bob,
          crypto.randomUUID()
        ]),
        /MESSAGE_RATE_LIMITED/
      );
      const received = (
        await as(bob, "select public.get_private_messages($1) value", [alice])
      )[0].value;
      assert.equal(received.items[0].gifUrl, gif);
      const reply = await send(
        bob,
        alice,
        "A reaction",
        "https://i.giphy.com/media/hello/giphy.gif"
      );
      assert.equal(reply.text, "A reaction");
      await assert.rejects(
        send(outsider, alice, "", gif),
        /MESSAGES_UNAVAILABLE/
      );
      assert.equal(
        (await db.query("select count(*)::int n from public.private_messages"))
          .rows[0].n,
        2
      );
    }
  );
  await t.test(
    "external URLs, scheme/hostname tricks, gallery data/blob URLs, oversized and empty content are rejected",
    async () => {
      for (const bad of [
        "https://example.com/image.gif",
        "http://media.giphy.com/media/a/giphy.gif",
        "https://media.giphy.com.evil.test/media/a/giphy.gif",
        "https://media.giphy.com@evil.test/media/a/giphy.gif",
        "javascript:alert(1)",
        "data:image/gif;base64,R0lG",
        "blob:http://localhost/123",
        "https://media.giphy.com/media/a/giphy.svg",
        gif + "#fragment",
        "https://media.giphy.com/media/" + "a".repeat(2048) + ".gif"
      ]) {
        await assert.rejects(send(alice, bob, "", bad), /MESSAGE_GIF_INVALID/);
      }
      await assert.rejects(send(alice, bob, "", null), /MESSAGE_INVALID/);
      await assert.rejects(send(alice, bob, " ", null), /MESSAGE_INVALID/);
      await assert.rejects(
        send(alice, bob, "a".repeat(2001), gif),
        /MESSAGE_INVALID/
      );
      assert.equal(
        (await db.query("select count(*)::int n from public.private_messages"))
          .rows[0].n,
        2
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from storage.buckets where id='private-message-media'"
          )
        ).rows[0].n,
        0
      );
    }
  );
  await t.test(
    "blocks, friendship removal, bans and deletion fences deny GIF sends too",
    async () => {
      for (const [blocker, blocked] of [
        [alice, bob],
        [bob, alice]
      ]) {
        await db.query(
          "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
          [blocker, blocked]
        );
        await assert.rejects(send(alice, bob, "", gif), /MESSAGES_UNAVAILABLE/);
        await assert.rejects(send(bob, alice, "", gif), /MESSAGES_UNAVAILABLE/);
        await db.exec("delete from public.user_blocks");
      }
      await db.exec("update public.friendships set status='pending'");
      await assert.rejects(send(alice, bob, "", gif), /MESSAGES_UNAVAILABLE/);
      await db.exec("update public.friendships set status='accepted'");
      await db.query(
        "update auth.users set banned_until='infinity' where id=$1",
        [bob]
      );
      await assert.rejects(send(alice, bob, "", gif), /MESSAGES_UNAVAILABLE/);
      await db.exec("update auth.users set banned_until=null");
      await db.query(
        "insert into public.account_deletion_log(user_id) values($1)",
        [bob]
      );
      await assert.rejects(send(alice, bob, "", gif), /MESSAGES_UNAVAILABLE/);
    }
  );
});
