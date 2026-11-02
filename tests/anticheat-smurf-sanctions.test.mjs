import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the browser corroboration is pseudonymous, short-lived and server-only", async () => {
  const [route, migration, docs, privacyEn, privacyFr] = await Promise.all([
    read("app/api/security/network-observation/route.ts"),
    read("supabase/migrations/20261102200000_admin_smurf_sanctions.sql"),
    read("docs/ANTICHEAT.md"),
    read("messages/en.json"),
    read("messages/fr.json")
  ]);
  assert.match(route, /randomBytes\(32\)/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /sameSite: "strict"/);
  assert.match(route, /record_anticheat_device_observation/);
  assert.doesNotMatch(route, /console\.(?:log|error)\([^)]*deviceIdentity/);
  assert.match(migration, /last_seen_at<stamp-interval '7 days'/);
  assert.match(migration, /to service_role/);
  assert.match(docs, /ne constitue pas une\s+empreinte matérielle/i);
  assert.match(
    JSON.parse(privacyEn).legalUi.antiCheatNetworkIdentity,
    /browser token/i
  );
  assert.match(
    JSON.parse(privacyFr).legalUi.antiCheatNetworkIdentity,
    /jeton navigateur/i
  );
  assert.match(
    JSON.parse(privacyEn).legalUi.weUseOneCookieToKeepYou,
    /anti-cheat token/i
  );
  assert.match(
    JSON.parse(privacyFr).legalUi.weUseOneCookieToKeepYou,
    /jeton anti-triche/i
  );
});

test("an admin can atomically ban a corroborated smurf and return only traceable gains", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column banned_until timestamptz, add column updated_at timestamptz; create table auth.sessions(user_id uuid)"
  );
  const smurf = "ac400000-0000-4000-8000-000000000001";
  const primary = "ac400000-0000-4000-8000-000000000002";
  const admin = "ac400000-0000-4000-8000-000000000003";
  const outsider = "ac400000-0000-4000-8000-000000000004";
  for (const [id, pseudo] of [
    [smurf, "FixtureSmurf"],
    [primary, "FixturePrimary"],
    [admin, "FixtureAdmin"],
    [outsider, "FixtureOutsider"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [smurf, primary]
  );
  await db.query(
    "update public.user_profiles set karas_balance=case when user_id=$1 then 100 when user_id=$2 then 900 else 0 end where user_id in($1,$2)",
    [smurf, primary]
  );
  const cardId = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('manual','smurf-sanction-fixture','Fixture','TEST','TEST','C','https://example.invalid/card.png') returning id"
    )
  ).rows[0].id;
  const instanceId = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity,is_first_owner) values($1,$2,'C',false) returning id",
      [primary, cardId]
    )
  ).rows[0].id;
  const soldInstanceId = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity,is_first_owner) values($1,$2,'C',false) returning id",
      [outsider, cardId]
    )
  ).rows[0].id;
  const tradeId = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,status,updated_at) values($1,$2,array[$3,$4]::uuid[],300,'accepted',now()) returning id",
      [smurf, primary, instanceId, soldInstanceId]
    )
  ).rows[0].id;
  const auctionId = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,status,current_price,buyer_id) values($1,$2,10,15,now(),'sold',200,$3) returning id",
      [soldInstanceId, primary, outsider]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,created_at,status,current_price,buyer_id) values($1,$2,10,15,now()-interval '2 days',now()-interval '2 days','sold',700,$3)",
    [soldInstanceId, primary, outsider]
  );
  const network = `v1:${"c".repeat(64)}`;
  const device = `v1:${"d".repeat(64)}`;
  for (const user of [smurf, primary]) {
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
      [network, user]
    );
    await db.query(
      "insert into public.anticheat_device_observations(device_identity,user_id) values($1,$2)",
      [device, user]
    );
  }

  const asAuthenticated = async (user, sql, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role");
    }
  };
  await assert.rejects(
    asAuthenticated(
      outsider,
      "select public.admin_preview_smurf_sanction($1,$2)",
      [smurf, primary]
    ),
    /ADMIN_REQUIRED/
  );
  const preview = (
    await asAuthenticated(
      admin,
      "select public.admin_preview_smurf_sanction($1,$2) value",
      [smurf, primary]
    )
  ).rows[0].value;
  assert.equal(preview.eligible, true);
  assert.deepEqual(preview.evidence, {
    sharedDevice: true,
    sharedNetwork: true,
    acceptedTrades: 1
  });
  assert.equal(preview.recovery.cards, 1);
  assert.equal(preview.recovery.tradeKaras, 300);
  assert.equal(preview.recovery.saleKaras, 200);
  assert.equal(preview.recovery.saleCount, 1);
  assert.equal(preview.recovery.karas, 500);

  await db.query(
    "update public.user_profiles set karas_balance=499 where user_id=$1",
    [primary]
  );
  await assert.rejects(
    asAuthenticated(
      admin,
      "select public.admin_apply_smurf_sanction($1,$2,$3,$1)",
      [smurf, primary, "Confirmed evidence but insufficient funds."]
    ),
    /SMURF_SANCTION_NOT_ELIGIBLE/
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.anticheat_smurf_sanctions"
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        instanceId
      ])
    ).rows[0].user_id,
    primary
  );
  await db.query(
    "update public.user_profiles set karas_balance=900 where user_id=$1",
    [primary]
  );

  await asAuthenticated(
    admin,
    "select public.admin_apply_smurf_sanction($1,$2,$3,$1)",
    [smurf, primary, "Confirmed same browser, network and direct trade."]
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        instanceId
      ])
    ).rows[0].user_id,
    smurf
  );
  assert.deepEqual(
    (
      await db.query(
        "select user_id,karas_balance from public.user_profiles where user_id in($1,$2) order by user_id",
        [smurf, primary]
      )
    ).rows,
    [
      { user_id: smurf, karas_balance: 600 },
      { user_id: primary, karas_balance: 400 }
    ]
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        soldInstanceId
      ])
    ).rows[0].user_id,
    outsider
  );
  assert.equal(
    (
      await db.query(
        "select banned_until>now() banned from auth.users where id=$1",
        [smurf]
      )
    ).rows[0].banned,
    true
  );
  const receipt = (
    await db.query(
      "select recovered_card_ids,recovered_trade_karas,recovered_sale_karas,recovered_karas,accepted_trade_ids,source_auction_ids,history,recovery_snapshot from public.anticheat_smurf_sanctions"
    )
  ).rows[0];
  assert.deepEqual(receipt.recovered_card_ids, [instanceId]);
  assert.deepEqual(receipt.accepted_trade_ids, [tradeId]);
  assert.deepEqual(receipt.source_auction_ids, [auctionId]);
  assert.equal(receipt.recovered_trade_karas, 300);
  assert.equal(receipt.recovered_sale_karas, 200);
  assert.equal(receipt.recovered_karas, 500);
  assert.equal(receipt.history.trades[0].id, tradeId);
  assert.equal(receipt.history.sales[0].id, auctionId);
  assert.equal(receipt.history.sales.length, 1);
  assert.equal(receipt.recovery_snapshot.karas, 500);
  await assert.rejects(
    db.query("delete from public.anticheat_smurf_sanctions"),
    /ANTICHEAT_LEDGER_IMMUTABLE/
  );
  await assert.rejects(
    asAuthenticated(
      admin,
      "select public.admin_apply_smurf_sanction($1,$2,$3,$1)",
      [smurf, primary, "Attempting to repeat the same sanction."]
    ),
    /ACCOUNT_BANNED|SMURF_SANCTION_NOT_ELIGIBLE/
  );
});

test("every event filter offered by the admin page is accepted and remains admin-only", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column banned_until timestamptz");
  const admin = "ac420000-0000-4000-8000-000000000001";
  const player = "ac420000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [admin, "FilterAdmin"],
    [player, "FilterPlayer"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  const page = await read("app/admin/security/page.tsx");
  const eventTypes = [
    ...page
      .match(/const eventTypes = new Set\(\[([\s\S]*?)\]\)/)[1]
      .matchAll(/"([a-z_]+)"/g)
  ].map(match => match[1]);
  assert.ok(eventTypes.includes("network_identity_shared"));
  assert.ok(eventTypes.includes("trade_shared_network_identity"));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin
  ]);
  await db.exec("set role authenticated");
  for (const type of ["", ...eventTypes]) {
    const payload = (
      await db.query(
        "select public.admin_list_anticheat_events(null,$1,40,0) value",
        [type]
      )
    ).rows[0].value;
    assert.ok(Array.isArray(payload.events));
    assert.ok(payload.events.every(event => !type || event.type === type));
  }
  await assert.rejects(
    db.query("select public.admin_list_anticheat_events(null,'unknown',40,0)"),
    /INVALID_ANTICHEAT_EVENT/
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  await assert.rejects(
    db.query(
      "select public.admin_list_anticheat_events(null,'network_identity_shared',40,0)"
    ),
    /ADMIN_REQUIRED/
  );
  await db.exec("reset role");
});

test("a shared network without the same browser token never enables the sanction", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column banned_until timestamptz, add column updated_at timestamptz"
  );
  const smurf = "ac410000-0000-4000-8000-000000000001";
  const primary = "ac410000-0000-4000-8000-000000000002";
  const admin = "ac410000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [smurf, "NetworkOnlySmurf"],
    [primary, "NetworkOnlyPrimary"],
    [admin, "NetworkOnlyAdmin"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [smurf, primary]
  );
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_karas,status) values($1,$2,10,'accepted')",
    [smurf, primary]
  );
  for (const user of [smurf, primary])
    await db.query(
      "insert into public.anticheat_network_observations(network_identity,user_id) values($1,$2)",
      [`v1:${"e".repeat(64)}`, user]
    );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin
  ]);
  await db.exec("set role authenticated");
  const preview = (
    await db.query("select public.admin_preview_smurf_sanction($1,$2) value", [
      smurf,
      primary
    ])
  ).rows[0].value;
  await db.exec("reset role");
  assert.equal(preview.evidence.sharedNetwork, true);
  assert.equal(preview.evidence.sharedDevice, false);
  assert.equal(preview.eligible, false);
});
