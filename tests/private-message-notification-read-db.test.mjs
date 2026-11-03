import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
test("opening a conversation clears only its fully observed message notification, preserving newer deliveries and other alerts", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const id = n => `af120000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [alice, bob, carol] = [1, 2, 3].map(id);
  for (const [i, u] of [alice, bob, carol].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [u, JSON.stringify({ pseudo: `ReadNotice${i}` })]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted'),($1,$3,'accepted')",
    [bob, alice, carol]
  );
  await db.exec("delete from public.notifications");
  const as = async (u, name, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [u]);
    try {
      return (
        await db.query(
          `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) v`,
          args
        )
      ).rows[0].v;
    } finally {
      await db.exec(
        "reset role;select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const cool = () =>
    db.exec(
      "update public.private_messages set created_at=clock_timestamp()-interval '2 seconds'"
    );
  const notes = () => as(bob, "list_notifications");
  const from = (ns, u) =>
    ns.find(n => n.type === "private_message_received" && n.referenceId === u);
  const first = await as(alice, "send_private_message", [bob, "First", id(10)]);
  await as(carol, "send_private_message", [bob, "Other conversation", id(11)]);
  await db.query(
    "insert into public.notifications(user_id,type,reference_id,actor_user_id)values($1,'wall_post_reply',$2,$3)",
    [bob, id(99), carol]
  );
  const fetched = await as(bob, "get_private_messages", [alice]);
  assert.equal(fetched.readThroughId, first.id);
  assert.equal(
    from(await notes(), alice).readAt,
    null,
    "Fetching alone is not proof of reading"
  );
  await cool();
  const second = await as(alice, "send_private_message", [
    bob,
    "Arrived while opening",
    id(12)
  ]);
  await as(bob, "mark_private_messages_read", [alice, first.id]);
  assert.equal(
    from(await notes(), alice).readAt,
    null,
    "Newer unseen delivery keeps notification active"
  );
  await as(bob, "mark_private_messages_read", [alice, second.id]);
  assert(from(await notes(), alice).readAt);
  assert.equal(from(await notes(), carol).readAt, null);
  assert.equal(
    (
      await db.query(
        "select read_at from public.notifications where user_id=$1 and type='wall_post_reply'",
        [bob]
      )
    ).rows[0].read_at,
    null
  );
  await cool();
  const third = await as(alice, "send_private_message", [
    bob,
    "Next arrival",
    id(13)
  ]);
  assert.equal(from(await notes(), alice).readAt, null);
  await as(bob, "mark_private_messages_read", [alice, first.id]);
  assert.equal(from(await notes(), alice).readAt, null);
  await as(bob, "mark_private_messages_read", [alice, third.id]);
  assert(from(await notes(), alice).readAt);
  assert.equal((await as(bob, "get_social_unread")).messageCount, 1);
  await assert.rejects(
    as(alice, "mark_private_messages_read", [bob, third.id]),
    /MESSAGE_READ_INVALID/
  );
});
