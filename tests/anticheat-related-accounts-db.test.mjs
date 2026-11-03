import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("the unified reader combines live, banned, deleted, network and browser links with exact flow directions, bounded search and private expired identities", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column email text,add column banned_until timestamptz"
  );
  const [
    admin,
    subject,
    active,
    deleted,
    network,
    browser,
    stale,
    unrelated,
    banned
  ] = Array.from(
    { length: 9 },
    (_, i) => `ac670000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  const ids = [
    admin,
    subject,
    active,
    deleted,
    network,
    browser,
    stale,
    unrelated,
    banned
  ];
  for (const [i, id] of ids.entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email)values($1,$2,$3)",
      [
        id,
        JSON.stringify({ pseudo: `Related${i}` }),
        `related${i}@example.invalid`
      ]
    );
  await db.query("insert into public.admin_users(user_id)values($1)", [admin]);
  const shared = `v1:${"e".repeat(64)}`,
    token = `v1:${"f".repeat(64)}`;
  for (const id of [subject, active, deleted, network])
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id)values($1,$2)",
      [shared, id]
    );
  await db.query(
    "insert into public.anticheat_network_observations(network_identity,user_id,first_seen_at,last_seen_at)values($1,$2,now()-interval '9 days',now()-interval '8 days')",
    [shared, stale]
  );
  for (const id of [subject, browser])
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id)values($1,$2)",
      [token, id]
    );
  const catalog = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)values('manual','related-status','BROLY','ANIME/MANGA','Dragon Ball','LR','https://example.invalid/broly.png')returning id"
    )
  ).rows[0].id;
  const copies = [];
  for (let i = 0; i < 3; i++)
    copies.push(
      (
        await db.query(
          "insert into public.user_cards(user_id,card_id,rarity)values($1,$2,'LR')returning id",
          [subject, catalog]
        )
      ).rows[0].id
    );
  const trade = async (from, to, give, receive, karasGive, karasReceive) => {
    await db.query(
      "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')on conflict do nothing",
      [from, to]
    );
    return (
      await db.query(
        "insert into public.trade_offers(from_user,to_user,offered_card_ids,requested_card_ids,offered_karas,requested_karas,status)values($1,$2,$3,$4,$5,$6,'accepted')returning id",
        [from, to, give, receive, karasGive, karasReceive]
      )
    ).rows[0].id;
  };
  await trade(active, subject, copies.slice(0, 2), copies.slice(2), 100, 20);
  await trade(subject, active, copies.slice(2), copies.slice(0, 1), 5, 30);
  await trade(deleted, subject, copies.slice(0, 1), [], 15, 0);
  await trade(banned, subject, [], [], 1, 0);
  await db.query(
    "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,status)values($1,$2,$3,10,50,15,now(),'sold')",
    [copies[1], active, subject]
  );
  await db.query("update auth.users set banned_until='infinity'where id=$1", [
    banned
  ]);
  const run = async (role, user, sql, args = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? ""
    ]);
    await db.exec(`set role ${role}`);
    try {
      return (await db.query(sql, args)).rows[0]?.value;
    } finally {
      await db.exec("reset role");
    }
  };
  const read = (
    query = "",
    status = "",
    limit = 30,
    offset = 0,
    target = subject
  ) =>
    run(
      "authenticated",
      admin,
      "select public.admin_list_anticheat_related_accounts($1,$2,$3,$4,$5)value",
      [target, query, status, limit, offset]
    );
  await run(
    "service_role",
    null,
    "select public.begin_account_deletion($1)value",
    [deleted]
  );
  let data = await read();
  assert.equal(
    data.accounts.find(a => a.userId === deleted).acceptedTrades,
    1,
    "a live trade duplicated in the archive counts once"
  );
  for (const id of [deleted, unrelated]) {
    await run(
      "service_role",
      null,
      "select public.begin_account_deletion($1)value",
      [id]
    );
    await run(
      "service_role",
      null,
      "select public.prepare_account_deletion($1)value",
      [id]
    );
    await db.query("delete from auth.users where id=$1", [id]);
  }
  data = await read();
  assert.equal(data.total, 5);
  assert.deepEqual(data.counts, { active: 3, banned: 1, deleted: 1 });
  assert.equal(new Set(data.accounts.map(a => a.userId)).size, 5);
  assert.equal(
    data.accounts.some(a => a.userId === stale || a.userId === unrelated),
    false
  );
  const a = data.accounts.find(a => a.userId === active);
  assert.equal(a.acceptedTrades, 2);
  assert.equal(a.cardsToSubject, 4);
  assert.equal(a.cardsFromSubject, 2);
  assert.equal(a.karasToSubject, 130);
  assert.equal(a.karasFromSubject, 75);
  assert.equal(a.soldAuctions, 1);
  assert.equal(a.sharedNetwork, true);
  assert.equal(a.sharedBrowser, false);
  assert.equal(data.accounts.find(a => a.userId === network).acceptedTrades, 0);
  assert.equal(
    data.accounts.find(a => a.userId === browser).sharedBrowser,
    true
  );
  assert.equal(
    data.accounts.find(a => a.userId === browser).sharedNetwork,
    false
  );
  assert.equal(
    data.accounts.find(a => a.userId === banned).accountState.banned,
    true
  );
  const gone = data.accounts.find(a => a.userId === deleted);
  assert.equal(gone.removed, true);
  assert.equal(gone.archived, true);
  assert.equal(gone.pseudo, "Related3");
  assert.equal(gone.email, "related3@example.invalid");
  assert.equal((await read("rElAtEd2")).accounts[0].userId, active);
  assert.equal(
    (await read("related3@example.invalid")).accounts[0].userId,
    deleted
  );
  assert.equal((await read("", "banned")).total, 1);
  assert.equal((await read("", "active")).total, 3);
  assert.equal((await read("", "deleted")).total, 1);
  assert.equal((await read("", "archived")).total, 2);
  const pages = [];
  for (let offset = 0; offset < 5; offset++)
    pages.push((await read("", "", 1, offset)).accounts[0].userId);
  assert.equal(new Set(pages).size, 5);
  assert.equal((await read("", "", 1000)).pageSize, 50);
  await assert.rejects(
    read("", "not-a-status"),
    /INVALID_RELATED_ACCOUNT_FILTER/
  );
  await assert.rejects(
    run(
      "authenticated",
      active,
      "select public.admin_list_anticheat_related_accounts($1)value",
      [subject]
    ),
    /ADMIN_REQUIRED/
  );
  for (const role of ["anon", "service_role"])
    await assert.rejects(
      run(
        role,
        null,
        "select public.admin_list_anticheat_related_accounts($1)value",
        [subject]
      ),
      /permission denied/
    );
  assert.doesNotMatch(
    JSON.stringify(data),
    /network_identity|device_identity|v1:|eeeeeeee|ffffffff/
  );
  await db.query(
    "update public.anticheat_deleted_accounts set identity_expires_at=now()-interval '1 second'where user_id=$1",
    [deleted]
  );
  data = await read();
  assert.equal(data.accounts.find(a => a.userId === deleted).pseudo, null);
  assert.equal(data.accounts.find(a => a.userId === deleted).email, null);
  assert.equal((await read("related3@example.invalid")).total, 0);
  const deletedSubject = await read("", "", 30, 0, deleted);
  assert.equal(deletedSubject.subject.removed, true);
  assert.equal(deletedSubject.subject.pseudo, null);
  assert.ok(deletedSubject.accounts.some(a => a.userId === subject));
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anticheat_smurf_sanctions"
      )
    ).rows[0].n,
    0,
    "reading does not apply a sanction"
  );
});
