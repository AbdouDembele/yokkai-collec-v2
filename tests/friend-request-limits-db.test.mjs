import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("friend requests enforce rolling quota, pair cooldown and transactional notification cleanup", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column banned_until timestamptz");
  const id = n => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [sender, target, other] = [1, 2, 3].map(id);
  for (let n = 1; n <= 40; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: `GuardPlayer${n}` })]
    );
  const login = async user => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const count = async (type = "friend_request") =>
    Number(
      (
        await db.query(
          "select count(*)::int n from public.notifications where user_id=$1 and type=$2",
          [target, type]
        )
      ).rows[0].n
    );
  const send = async (target = other) =>
    (await db.query("select public.send_friend_request($1) id", [target]))
      .rows[0].id;
  await login(sender);
  const first = await send(target);
  await login(target);
  assert.equal(await count(), 1);
  await db.exec("reset role");
  await db.query(
    "insert into public.notifications(user_id,type,reference_id) values($1,'outbid',$2)",
    [target, id(999)]
  );
  await login(sender);
  await db.query("select public.cancel_friend_request($1)", [target]);
  await login(target);
  assert.equal(await count(), 0);
  assert.equal(await count("outbid"), 1);
  await login(sender);
  await assert.rejects(send(target), /FRIEND_REQUEST_COOLDOWN/);
  await send(other); // A different target is unaffected.
  await db.exec("reset role");
  await db.query(
    "update public.friend_request_events set occurred_at=clock_timestamp()-interval '24 hours 1 second' where user_id=$1 and friend_id=$2 and kind='closed'",
    [sender, target]
  );
  await login(sender);
  const second = await send(target);
  assert.notEqual(second, first);
  await assert.rejects(send(target), /FRIENDSHIP_EXISTS/);
  await login(target);
  assert.equal(await count(), 1);
  await db.query("select public.respond_friend_request($1,false)", [second]);
  assert.equal(await count(), 0);
  await login(sender);
  await assert.rejects(send(target), /FRIEND_REQUEST_COOLDOWN/);
  // Reverse direction remains private and independent. Acceptance clears an old
  // refusal cooldown so removing an accepted friendship never adds a cooldown.
  await login(target);
  const reverse = await send(sender);
  await login(sender);
  await db.query("select public.respond_friend_request($1,true)", [reverse]);
  await db.query("select public.remove_friend($1)", [target]);
  const accepted = await send(target);
  await login(target);
  await db.query("select public.respond_friend_request($1,true)", [accepted]);
  assert.equal(await count(), 0);
  await login(sender);
  await db.query("select public.remove_friend($1)", [target]);
  const cancellable = await send(target);
  assert.ok(cancellable);
  await db.query("select public.cancel_friend_request($1)", [target]);
  // Successful sends still count after cancellation, refusal and acceptance.
  await db.exec("reset role");
  const sent = Number(
    (
      await db.query(
        "select count(*)::int n from public.friend_request_events where user_id=$1 and kind='sent'",
        [sender]
      )
    ).rows[0].n
  );
  assert.equal(sent, 5);
  await login(sender);
  for (let n = 4; n < 4 + 30 - sent; n++) await send(id(n));
  await assert.rejects(send(id(35)), /FRIEND_REQUEST_LIMIT/);
  await db.exec("reset role");
  await db.query(
    "update public.friend_request_events set occurred_at=clock_timestamp()-interval '24 hours 1 second' where user_id=$1 and kind='sent' and friend_id=$2",
    [sender, other]
  );
  await login(sender);
  await send(id(35));
  await assert.rejects(send(id(36)), /FRIEND_REQUEST_LIMIT/);
  await login(id(36));
  await db.query("select public.block_user($1)", [sender]);
  await login(sender);
  await assert.rejects(send(id(36)), /ACTION_UNAVAILABLE/);
  await db.exec("reset role");
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [sender, id(37)]
  );
  await login(sender);
  await assert.rejects(send(id(37)), /ACTION_UNAVAILABLE/);
  await assert.rejects(
    db.query("select * from public.friend_request_events"),
    /permission denied/
  );
  await db.exec("reset role;set role service_role");
  await assert.rejects(
    db.query("select * from public.friend_request_events"),
    /permission denied/
  );
  await db.exec("reset role");
  const lockDef = (
    await db.query(
      "select pg_get_functiondef('public.send_friend_request(uuid)'::regprocedure) value"
    )
  ).rows[0].value;
  assert.match(lockDef, /pg_advisory_xact_lock.*friend-request-sender:/);
  const cron = (
    await db.query(
      "select command from cron.job where jobname='purge-friend-request-events'"
    )
  ).rows[0];
  assert.match(cron.command, /24 hours/);
  await db.query(
    "update public.friend_request_events set occurred_at=occurred_at-interval '25 hours' where user_id=$1",
    [sender]
  );
  await db.exec(cron.command);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.friend_request_events where user_id=$1",
        [sender]
      )
    ).rows[0].n,
    0
  );
});

test("upgrade recovers available recent sends and removes only stale friend-request notifications", async t => {
  const migration = "20261026010000_friend_request_limits.sql";
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = readdirSync(directory)
    .filter(name => name.endsWith(".sql") && name < migration)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  const a = "99200000-0000-4000-8000-000000000001",
    b = "99200000-0000-4000-8000-000000000002",
    c = "99200000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [a, "UpgradeSender"],
    [b, "UpgradeAccept"],
    [c, "UpgradePending"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  const login = async user => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  await login(a);
  await db.query("select public.send_friend_request($1)", [b]);
  await db.query("select public.cancel_friend_request($1)", [b]);
  const accepted = (
    await db.query("select public.send_friend_request($1) id", [b])
  ).rows[0].id;
  await login(b);
  await db.query("select public.respond_friend_request($1,true)", [accepted]);
  await login(a);
  const pending = (
    await db.query("select public.send_friend_request($1) id", [c])
  ).rows[0].id;
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.notifications where type='friend_request'"
      )
    ).rows[0].n,
    3
  );
  await db.exec(readFileSync(new URL(migration, directory), "utf8"));
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.notifications where type='friend_request'"
      )
    ).rows[0].n,
    1
  );
  assert.equal(
    (
      await db.query(
        "select reference_id from public.notifications where type='friend_request'"
      )
    ).rows[0].reference_id,
    pending
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.friend_request_events where user_id=$1 and kind='sent'",
        [a]
      )
    ).rows[0].n,
    2
  );
  await login(a);
  await db.query("select public.cancel_friend_request($1)", [c]);
  await assert.rejects(
    db.query("select public.send_friend_request($1)", [c]),
    /FRIEND_REQUEST_COOLDOWN/
  );
});

test("request traces export only the sender's recent events and disappear during account preparation", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column banned_until timestamptz;create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  const a = "99100000-0000-4000-8000-000000000001",
    b = "99100000-0000-4000-8000-000000000002",
    r = "99100000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [a, "TraceSender"],
    [b, "TraceRecipient"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  const login = async id => {
    await db.exec("reset role;set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  await login(a);
  await db.query("select public.send_friend_request($1)", [b]);
  await db.query("select public.cancel_friend_request($1)", [b]);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec("set role service_role");
  await assert.rejects(
    db.query("select public.build_data_export($1,$2)", [a, r]),
    /EXPORT_RESERVATION_REQUIRED/
  );
  await db.query("select public.reserve_data_export($1,$2)", [a, r]);
  const exported = (
    await db.query("select public.build_data_export($1,$2) value", [a, r])
  ).rows[0].value;
  assert.equal(exported.friend_request_events.length, 2);
  assert.deepEqual(
    new Set(exported.friend_request_events.map(e => e.kind)),
    new Set(["sent", "closed"])
  );
  assert.ok(
    !JSON.stringify(exported.friend_request_events).includes(b),
    "never export another player UUID"
  );
  await db.query("select public.reserve_data_export($1,$2)", [b, r]);
  const received = (
    await db.query("select public.build_data_export($1,$2) value", [b, r])
  ).rows[0].value;
  assert.deepEqual(
    received.friend_request_events,
    [],
    "recipient cannot learn another sender quota/cooldown history"
  );
  await db.query("select public.begin_account_deletion($1)", [b]);
  await login(a);
  await assert.rejects(
    db.query("select public.send_friend_request($1)", [b]),
    /ACCOUNT_DELETED|ACTION_UNAVAILABLE/
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec("set role service_role");
  await db.query("select public.prepare_account_deletion($1)", [b]);
  await db.exec("reset role");
  assert.equal(
    (await db.query("select count(*)::int n from public.friend_request_events"))
      .rows[0].n,
    0
  );
  // Cascades also cover the Auth deletion path for the sender.
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"TraceThird"}\')',
    [r]
  );
  await login(a);
  await db.query("select public.send_friend_request($1)", [r]);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("delete from auth.users where id=$1", [a]);
  assert.equal(
    (await db.query("select count(*)::int n from public.friend_request_events"))
      .rows[0].n,
    0
  );
});
