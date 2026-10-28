import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const id = n => `c6200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("conversation index is private, paginated, moderation-safe and never acknowledges unread messages", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  for (let n = 1; n <= 4; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2::jsonb)",
      [id(n), JSON.stringify({ pseudo: `InboxFixture${n}` })]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted'),($1,$3,'accepted'),($3,$4,'accepted')",
    [id(1), id(2), id(3), id(4)]
  );
  const messages = [];
  for (const [sender, recipient, body, at] of [
    [2, 1, "hello one", "2026-10-01T12:00:00Z"],
    [2, 1, "hello two", "2026-10-01T12:01:00Z"],
    [1, 3, "sent only", "2026-10-01T12:02:00Z"],
    [3, 4, "outsider secret", "2026-10-01T12:03:00Z"]
  ]) {
    const message = crypto.randomUUID();
    messages.push(message);
    await db.query(
      "insert into public.private_messages(id,sender_id,recipient_id,body,created_at)values($1,$2,$3,$4,$5)",
      [message, id(sender), id(recipient), body, at]
    );
  }
  const as = async (user, sql, args = [], role = "authenticated") => {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? ""
    ]);
    try {
      return (await db.query(sql, args)).rows[0]?.value;
    } finally {
      await db.exec("reset role");
    }
  };
  const list = (user, before = null, cursor = null, limit = 30) =>
    as(user, "select public.get_private_conversations($1,$2,$3) value", [
      before,
      cursor,
      limit
    ]);
  await assert.rejects(
    as(null, "select public.get_private_conversations()", [], "anon"),
    /permission denied/
  );
  await assert.rejects(list(null), /AUTH_REQUIRED/);
  await assert.rejects(
    list(id(1), "2026-10-01T12:00:00Z"),
    /MESSAGE_CURSOR_INVALID/
  );
  const first = await list(id(1), null, null, 1);
  assert.equal(first.viewerId, id(1));
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].friend.id, id(3));
  assert.equal(first.items[0].own, true);
  assert.equal(first.items[0].preview, "sent only");
  assert(first.next);
  const next = await list(id(1), first.next.at, first.next.id, 1);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].friend.id, id(2));
  assert.equal(next.next, null);
  assert.equal(next.items[0].preview, "hello two");
  assert.equal(
    (await as(id(1), "select public.get_social_unread() value")).messageCount,
    2,
    "opening the conversation list does not mark messages read"
  );
  assert.equal(JSON.stringify(first).includes("outsider secret"), false);
  const outsider = await list(id(4));
  assert.deepEqual(
    outsider.items.map(item => item.friend.id),
    [id(3)]
  );
  await db.query(
    "update public.private_messages set body='',gif_url=null,moderated_at=clock_timestamp()where id=$1",
    [messages[1]]
  );
  const moderated = (await list(id(1))).items.find(
    item => item.friend.id === id(2)
  );
  assert.equal(moderated.kind, "moderated");
  assert.equal(moderated.preview, "");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id)values($1,$2)",
    [id(2), id(1)]
  );
  assert.deepEqual(
    (await list(id(1))).items.map(item => item.friend.id),
    [id(3)],
    "a block in either direction hides the conversation"
  );
  await db.query("delete from public.user_blocks where blocker_id=$1", [id(2)]);
  await db.query("update auth.users set banned_until='infinity'where id=$1", [
    id(3)
  ]);
  assert.deepEqual(
    (await list(id(1))).items.map(item => item.friend.id),
    [id(2)],
    "banned conversation partners disappear"
  );
  await db.query("update auth.users set banned_until=null where id=$1", [
    id(3)
  ]);
  await db.query(
    "delete from public.friendships where user_id=$1 and friend_id=$2",
    [id(1), id(2)]
  );
  assert.deepEqual(
    (await list(id(1))).items.map(item => item.friend.id),
    [id(3)],
    "former friends cannot be listed"
  );
  await db.query("update auth.users set banned_until='infinity'where id=$1", [
    id(1)
  ]);
  await assert.rejects(list(id(1)), /ACCOUNT_BANNED/);
});
