import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("private notifications coalesce, keep content private and respect conversation access; authored messages join the bounded export", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // GIF verified by the server route (#379 C2); unverified ones are refused.
  await db.exec(
    "insert into public.giphy_gif_ratings(gif_id,rating) values ('private-proof','g')"
  );
  const alice = "40000000-0000-4000-8000-000000000001",
    bob = "40000000-0000-4000-8000-000000000002",
    other = "40000000-0000-4000-8000-000000000003";
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  for (const [id, pseudo] of [
    [alice, "NotifyAlice"],
    [bob, "NotifyBob"],
    [other, "NotifyOther"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [alice, bob]
  );
  await db.exec("delete from public.notifications");
  const as = async (id, sql, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const send = async (
    user,
    friend,
    body,
    id = crypto.randomUUID(),
    gif = null
  ) =>
    (
      await as(
        user,
        "select public.send_private_message_gif($1,$2,$3,$4) value",
        [friend, body, id, gif]
      )
    )[0].value;
  const list = async user =>
    (await as(user, "select public.list_notifications() value"))[0].value;
  const id = crypto.randomUUID();
  const secret = "Private contents must not appear in the bell";
  await send(alice, bob, secret, id);
  const first = (await list(bob)).find(
    item => item.type === "private_message_received"
  );
  assert.ok(first);
  assert.equal(first.referenceId, alice);
  assert.equal(first.actorPseudo, "NotifyAlice");
  assert.equal(first.readAt, null);
  assert.ok(!JSON.stringify(first).includes(secret));
  assert.equal((await list(alice)).length, 0);
  assert.equal((await list(other)).length, 0);
  await as(bob, "select public.mark_notification_read($1)", [first.id]);
  const read = (await list(bob))[0].readAt;
  assert.ok(read);
  await send(alice, bob, secret, id);
  assert.equal(
    (await list(bob))[0].readAt,
    read,
    "Identical send retries must not notify again"
  );
  await db.exec(
    "update public.private_messages set created_at=clock_timestamp()-interval '2 seconds'"
  );
  const gif = "https://media.giphy.com/media/private-proof/giphy.gif";
  await send(alice, bob, "", crypto.randomUUID(), gif);
  const items = await list(bob);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, first.id);
  assert.equal(items[0].readAt, null);
  assert.ok(!JSON.stringify(items).includes(gif));
  assert.equal(
    (await as(other, "select count(*)::int n from public.notifications"))[0].n,
    0,
    "Recipient-only RLS protects realtime reads"
  );
  await send(bob, alice, "Bob's authored reply");
  const request = crypto.randomUUID();
  await db.query("select public.reserve_data_export($1,$2)", [alice, request]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [
      alice,
      request
    ])
  ).rows[0].value;
  assert.equal(exported.private_messages.length, 2);
  assert.ok(exported.private_messages.some(message => message.text === secret));
  assert.ok(exported.private_messages.some(message => message.gif_url === gif));
  assert.ok(
    exported.private_messages.every(
      message => message.recipient.pseudo === "NotifyBob"
    )
  );
  assert.ok(
    !JSON.stringify(exported.private_messages).includes(bob),
    "Other players' UUIDs stay excluded from the personal export"
  );
  assert.ok(
    !JSON.stringify(exported.private_messages).includes("Bob's authored reply"),
    "Do not export another author's content"
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [bob, alice]
  );
  assert.equal(
    (await list(bob)).filter(item => item.type === "private_message_received")
      .length,
    0
  );
  await db.exec(
    "delete from public.user_blocks; update public.friendships set status='pending'"
  );
  assert.equal(
    (await list(bob)).filter(item => item.type === "private_message_received")
      .length,
    0
  );
  await db.exec("update public.friendships set status='accepted'");
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    alice
  ]);
  assert.equal(
    (await list(bob)).filter(item => item.type === "private_message_received")
      .length,
    0
  );
});

function loadTs(file, require, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  vm.runInNewContext(code, { exports, require, ...globals });
  return exports;
}
test("private notification opens the sender's conversation and never contains a private preview", () => {
  const require = createRequire(import.meta.url);
  const api = loadTs("components/topbar.tsx", name =>
    name === "react" || name === "react/jsx-runtime" ? require(name) : {}
  );
  const item = api.notificationItem({
    id: "note",
    type: "private_message_received",
    referenceId: "alice",
    actorPseudo: "Alice",
    readAt: null,
    createdAt: "2026-10-19T10:00:00Z",
    cardName: null,
    achievementName: null
  });
  assert.equal(item.href, "/social/friends?message=alice");
  assert.equal(item.title, "New private message");
  assert.equal(item.kind, "message");
  assert.equal(item.read, false);
});
test("realtime subscribes only to the authenticated recipient, refreshes protected data and cleans up", async () => {
  const handlers = [];
  let removed = 0,
    refreshed = 0,
    events = 0;
  const channel = {
    on(kind, filter, callback) {
      handlers.push({ kind, filter, callback });
      return this;
    },
    subscribe(callback) {
      callback("SUBSCRIBED");
      return this;
    }
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "bob" } }, error: null })
    },
    channel: () => channel,
    removeChannel: async value => {
      assert.equal(value, channel);
      removed++;
    }
  };
  const api = loadTs(
    "lib/data/notifications.ts",
    name =>
      name === "@/utils/supabase/client" ? { createClient: () => client } : {},
    { crypto, window: { dispatchEvent: () => events++ }, Event }
  );
  const stop = api.subscribeNotifications(() => refreshed++);
  await Promise.resolve();
  await Promise.resolve();
  const changes = handlers.filter(
    handler => handler.kind === "postgres_changes"
  );
  assert.equal(changes.length, 2);
  assert.deepEqual(
    changes.map(handler => handler.filter.event),
    ["INSERT", "UPDATE"]
  );
  assert.ok(
    changes.every(
      handler =>
        handler.filter.table === "notifications" &&
        handler.filter.filter === "user_id=eq.bob"
    )
  );
  handlers
    .find(handler => handler.kind === "system")
    .callback({ status: "ok" });
  assert.equal(refreshed, 2);
  handlers[0].callback({ new: { type: "private_message_received" } });
  assert.equal(events, 1);
  assert.equal(refreshed, 3);
  stop();
  assert.equal(removed, 1);
  handlers[0].callback({ new: { type: "private_message_received" } });
  assert.equal(events, 1);
  assert.equal(refreshed, 3);
});
