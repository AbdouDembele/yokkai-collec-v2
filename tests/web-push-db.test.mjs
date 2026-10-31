import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("push trigger covers inserts and coalesced events; RPC applies recipient visibility and RLS isolates subscriptions", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const alice = "71000000-0000-4000-8000-000000000001";
  const bob = "71000000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [alice, "PushAlice"],
    [bob, "PushBob"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.exec(`create schema net; create table net.requests(body jsonb);
    create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer)
    returns bigint language plpgsql as $$ begin insert into net.requests values(body); return 1; end $$;
    insert into public.push_dispatch_config(url,secret) values('https://example.test/api/push/dispatch',repeat('s',32));`);
  await db.query(
    "insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values($1,'https://fcm.googleapis.com/send/proof',repeat('a',87),repeat('b',22))",
    [alice]
  );
  await db.query(
    "update public.user_profiles set locale='fr' where user_id=$1",
    [alice]
  );
  const {
    rows: [notification]
  } = await db.query(
    `insert into public.notifications(user_id,type,reference_id)
    values($1,'friend_request',gen_random_uuid()) returning id,created_at::text`,
    [alice]
  );
  const read = async () =>
    (
      await db.query("select public.get_push_notification($1,$2) value", [
        notification.id,
        notification.created_at
      ])
    ).rows[0].value;
  const value = await read();
  assert.equal(value?.notification?.id, notification.id);
  assert.equal(value.locale, "fr");
  assert.equal(
    (await db.query("select auth.uid() value")).rows[0].value,
    null,
    "RPC must restore service context"
  );
  await db.query("update public.notifications set read_at=now() where id=$1", [
    notification.id
  ]);
  assert.equal(
    (await db.query("select count(*)::int total from net.requests")).rows[0]
      .total,
    1
  );
  await db.query(
    "update public.notifications set created_at=clock_timestamp(),read_at=null where id=$1",
    [notification.id]
  );
  assert.equal(
    (await db.query("select count(*)::int total from net.requests")).rows[0]
      .total,
    2
  );
  assert.equal(
    await read(),
    null,
    "superseded webhook must not send the newest event twice"
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int total from public.push_subscriptions"
      )
    ).rows[0].total,
    0
  );
  assert.equal(
    (
      await db.query(
        "update public.push_subscriptions set user_id=$1 returning endpoint",
        [bob]
      )
    ).rows.length,
    0
  );
  await assert.rejects(
    db.query("select public.get_push_notification($1,$2)", [
      notification.id,
      notification.created_at
    ]),
    /permission denied/
  );
  await assert.rejects(
    db.query("select * from public.push_dispatch_config"),
    /permission denied/
  );
  await db.exec(
    "reset role; select set_config('request.jwt.claim.sub','',false)"
  );
  const {
    rows: [mention]
  } = await db.query(
    `insert into public.notifications(user_id,type,reference_id,actor_user_id)
    values($1,'auction_chat_mention',gen_random_uuid(),$2) returning id,created_at::text`,
    [alice, bob]
  );
  const visible = async () =>
    (
      await db.query("select public.get_push_notification($1,$2) value", [
        mention.id,
        mention.created_at
      ])
    ).rows[0].value;
  assert.equal((await visible()).notification.actorPseudo, "PushBob");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [alice, bob]
  );
  assert.equal(
    (await visible())?.notification ?? null,
    null,
    "blocked interactions cannot leak through push"
  );
});

test("banned tokens cannot create, update or delete push subscriptions", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const player = "71000000-0000-4000-8000-000000000099";
  await db.exec("alter table auth.users add column banned_until timestamptz");
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [player, JSON.stringify({ pseudo: "BannedPush" })]
  );
  await db.query(
    "insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values($1,'https://fcm.googleapis.com/send/ban-proof',repeat('a',87),repeat('b',22))",
    [player]
  );
  await db.query("update auth.users set banned_until='infinity' where id=$1", [
    player
  ]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  for (const query of [
    "insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values(auth.uid(),'https://fcm.googleapis.com/send/ban-new',repeat('a',87),repeat('b',22))",
    "update public.push_subscriptions set auth=repeat('c',22)",
    "delete from public.push_subscriptions"
  ])
    await assert.rejects(db.exec(query), /ACCOUNT_BANNED/);
});
