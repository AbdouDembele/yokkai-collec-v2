import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("Everyone relationships reuse friendship_state and preserve the complete timeline contract", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column banned_until timestamptz");
  const id = n => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [viewer, friend, outgoing, incoming, stranger, privateOwner] = [
    1, 2, 3, 4, 5, 6
  ].map(id);
  for (const [n, user] of [
    viewer,
    friend,
    outgoing,
    incoming,
    stranger,
    privateOwner
  ].entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user, JSON.stringify({ pseudo: `Relation${n}` })]
    );
    await db.query(
      "update public.user_profiles set is_public=$2 where user_id=$1",
      [user, user !== privateOwner]
    );
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body,created_at) values($1,$2,$3,'2026-10-25T00:00:00Z')",
      [id(100 + n), user, `Story ${n}`]
    );
  }
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted'),($1,$3,'pending'),($4,$1,'pending')",
    [viewer, friend, outgoing, incoming]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id) values($1,$2)",
    [friend, stranger]
  );
  const requestId = (
    await db.query(
      "select id from public.friendships where user_id=$1 and friend_id=$2",
      [incoming, viewer]
    )
  ).rows[0].id;
  // Keep the immutable PR4 projection as a full payload/cursor reference.
  const previous = readFileSync(
    new URL(
      "../supabase/migrations/20261025120000_public_wall_feed.sql",
      import.meta.url
    ),
    "utf8"
  );
  const old = previous
    .slice(
      previous.indexOf("create function public.get_public_wall_feed("),
      previous.indexOf("revoke all on function public.get_public_wall_feed")
    )
    .replace(
      "public.get_public_wall_feed(",
      "public.test_public_feed_before_relationship("
    );
  await db.exec(
    old +
      "grant execute on function public.test_public_feed_before_relationship(timestamptz,uuid,integer) to authenticated;"
  );
  const login = async user => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const feed = async (cursor = null, limit = 20) =>
    (
      await db.query("select public.get_public_wall_feed($1,$2,$3) value", [
        cursor?.at ?? null,
        cursor?.id ?? null,
        limit
      ])
    ).rows[0].value;
  await login(viewer);
  const page = await feed();
  const expected = new Map([
    [viewer, "self"],
    [friend, "friends"],
    [outgoing, "outgoing_pending"],
    [incoming, "incoming_pending"],
    [stranger, "none"]
  ]);
  for (const item of page.items) {
    assert.equal(item.relationship, expected.get(item.author.id));
    assert.equal(
      item.requestId,
      item.author.id === incoming ? requestId : null
    );
  }
  assert.equal(page.items.length, 5);
  for (const limit of [1, 2, 10, 20, 100]) {
    let cursor = null;
    do {
      const current = await feed(cursor, limit);
      const before = (
        await db.query(
          "select public.test_public_feed_before_relationship($1,$2,$3) value",
          [cursor?.at ?? null, cursor?.id ?? null, limit]
        )
      ).rows[0].value;
      assert.deepEqual(
        {
          ...current,
          items: current.items.map(({ relationship, requestId, ...post }) => {
            void relationship;
            void requestId;
            return post;
          })
        },
        before
      );
      cursor = current.next;
    } while (cursor);
  }
  // The helper is owner-only; inspect it under the fixture owner, never grant it.
  await db.exec("reset role");
  const helper = (
    await db.query("select public.friendship_state($1,$2) value", [
      viewer,
      incoming
    ])
  ).rows[0].value;
  assert.equal(helper, "incoming");
  await login(viewer);
  await db.query("select public.respond_friend_request($1,true)", [requestId]);
  assert.equal(
    (await feed()).items.find(p => p.author.id === incoming).relationship,
    "friends"
  );
  await db.query("select public.remove_friend($1)", [incoming]);
  assert.equal(
    (await feed()).items.find(p => p.author.id === incoming).relationship,
    "none"
  );
  await db.query("select public.send_friend_request($1)", [incoming]);
  assert.equal(
    (await feed()).items.find(p => p.author.id === incoming).relationship,
    "outgoing_pending"
  );
  await db.query("select public.cancel_friend_request($1)", [incoming]);
  assert.equal(
    (await feed()).items.find(p => p.author.id === incoming).relationship,
    "none"
  );
  await login(incoming);
  const freshRequest = (
    await db.query("select public.send_friend_request($1) id", [viewer])
  ).rows[0].id;
  await login(viewer);
  const receivedAgain = (await feed()).items.find(
    p => p.author.id === incoming
  );
  assert.equal(receivedAgain.relationship, "incoming_pending");
  assert.equal(receivedAgain.requestId, freshRequest);
  assert.notEqual(freshRequest, requestId);
  await db.query("select public.respond_friend_request($1,false)", [
    freshRequest
  ]);
  assert.equal(
    (await feed()).items.find(p => p.author.id === incoming).relationship,
    "none"
  );
  await assert.rejects(
    db.query("select public.cancel_friend_request($1)", [friend]),
    /ACTION_UNAVAILABLE/
  );
  await login(outgoing);
  await assert.rejects(
    db.query("select public.cancel_friend_request($1)", [viewer]),
    /ACTION_UNAVAILABLE/
  );
  await login(viewer);
  await db.query("select public.cancel_friend_request($1)", [outgoing]);
  await assert.rejects(
    db.query("select public.send_friend_request($1)", [outgoing]),
    /FRIEND_REQUEST_COOLDOWN/
  );
  await db.exec("reset role");
  await db.query(
    "update public.friend_request_events set occurred_at=occurred_at-interval '24 hours 1 second' where user_id=$1 and friend_id=$2 and kind='closed'",
    [viewer, outgoing]
  );
  await login(viewer);
  await db.query("select public.send_friend_request($1)", [outgoing]);
  await assert.rejects(
    db.query("select public.send_friend_request($1)", [outgoing]),
    /FRIENDSHIP_EXISTS/
  );
  await db.exec("reset role");
  const mapping = {
    none: "none",
    accepted: "friends",
    outgoing: "outgoing_pending",
    incoming: "incoming_pending"
  };
  for (const author of [friend, outgoing, incoming, stranger]) {
    const state = (
      await db.query("select public.friendship_state($1,$2) state", [
        viewer,
        author
      ])
    ).rows[0].state;
    await login(viewer);
    assert.equal(
      (await feed()).items.find(p => p.author.id === author).relationship,
      mapping[state]
    );
    await db.exec("reset role");
  }
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select public.cancel_friend_request($1)", [stranger]),
    /permission denied/
  );
  await login("");
  await assert.rejects(
    db.query("select public.cancel_friend_request($1)", [stranger]),
    /AUTH_REQUIRED/
  );
  await db.exec("reset role");
  await db.exec(`
    insert into auth.users(id,raw_user_meta_data)
      select ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
        jsonb_build_object('pseudo','PlanFriend'||n) from generate_series(1,1000) n;
    insert into public.friendships(user_id,friend_id)
      select ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
        ('97000000-0000-4000-8000-'||lpad(((n+d-1)%1000+1)::text,12,'0'))::uuid
      from generate_series(1,1000) n cross join generate_series(1,10) d;
    analyze public.friendships;
  `);
  const other = "97000000-0000-4000-8000-000000000002";
  const plans = {};
  // SECURITY DEFINER SQL helpers are opaque to outer EXPLAIN. Inspect the exact
  // authoritative helper predicate separately, without changing or granting it.
  plans.state = (
    await db.query(
      `explain (analyze,buffers,format json)
    select case when f.status='accepted' then 'accepted' when f.user_id=$1 then 'outgoing' else 'incoming' end
    from public.friendships f where (f.user_id=$1 and f.friend_id=$2) or (f.user_id=$2 and f.friend_id=$1) limit 1`,
      [viewer, other]
    )
  ).rows;
  plans.request = (
    await db.query(
      `explain (analyze,buffers,format json)
    select f.id from public.friendships f where f.user_id=$1 and f.friend_id=$2 and f.status='pending'`,
      [other, viewer]
    )
  ).rows;
  const size = (
    await db.query(
      "select count(*)::int rows,pg_total_relation_size('public.friendships') bytes from public.friendships"
    )
  ).rows[0];
  for (const plan of Object.values(plans)) {
    assert.match(JSON.stringify(plan), /Index|Bitmap/);
    assert.doesNotMatch(JSON.stringify(plan), /Seq Scan/);
  }
  console.log("Relationship EXPLAIN", JSON.stringify({ size, plans }));
});
