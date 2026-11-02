import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("anti-cheat records real triggers, scores signals and isolates its ledger", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column email text");
  const source = "ac100000-0000-4000-8000-000000000001";
  const recipient = "ac100000-0000-4000-8000-000000000002";
  const admin = "ac100000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [source, "SignalSource"],
    [recipient, "SignalRecipient"],
    [admin, "SignalAdmin"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email) values($1,$2,$3)",
      [id, JSON.stringify({ pseudo }), `${pseudo}@example.test`]
    );
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_events where event_type='account_registered'"
      )
    ).rows[0].total,
    3
  );

  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [source, recipient]
  );
  const trade = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_karas) values($1,$2,6000) returning id",
      [source, recipient]
    )
  ).rows[0].id;
  await db.query(
    "update public.trade_offers set status='accepted' where id=$1",
    [trade]
  );
  // Unrelated updates must not count the same acceptance twice.
  await db.query(
    "update public.trade_offers set updated_at=clock_timestamp() where id=$1",
    [trade]
  );
  const accepted = (
    await db.query(
      "select * from public.anticheat_events where subject_id=$1 and event_type='trade_accepted'",
      [trade]
    )
  ).rows;
  assert.equal(accepted.length, 1);
  const subjects = (
    await db.query(
      "select user_id,risk_points,reason_codes from public.anticheat_event_subjects where event_id=$1 order by user_id",
      [accepted[0].id]
    )
  ).rows;
  assert.deepEqual(subjects, [
    {
      user_id: source,
      risk_points: 55,
      reason_codes: [
        "ONE_WAY_TRADE_SOURCE",
        "TRADE_VALUE_IMBALANCE",
        "LARGE_KARA_TRANSFER",
        "NEW_ACCOUNT_ECONOMIC_ACTIVITY"
      ]
    },
    {
      user_id: recipient,
      risk_points: 67,
      reason_codes: [
        "ONE_WAY_TRADE_BENEFICIARY",
        "TRADE_VALUE_IMBALANCE",
        "LARGE_KARA_TRANSFER",
        "NEW_ACCOUNT_ECONOMIC_ACTIVITY"
      ]
    }
  ]);

  const record = async (type, metadata = {}, occurredAt = null) =>
    (
      await db.query(
        "select public.record_anticheat_event($1,$2,$3,null,0,0,$4,$5) id",
        [type, source, recipient, JSON.stringify(metadata), occurredAt]
      )
    ).rows[0].id;
  for (let i = 0; i < 3; i++)
    await record("trade_accepted", { offeredTotal: 1, requestedTotal: 1 });
  const repeated = (
    await db.query(
      "select reason_codes from public.anticheat_event_subjects where event_id=(select max(id) from public.anticheat_events) and user_id=$1",
      [recipient]
    )
  ).rows[0].reason_codes;
  assert.ok(repeated.includes("REPEATED_TRADE_PAIR"));
  // Historic replay cannot interpret a future registration as a recent account.
  const historic = await record(
    "trade_accepted",
    { offeredTotal: 1, requestedTotal: 1 },
    "2020-01-01T00:00:00Z"
  );
  assert.ok(
    (
      await db.query(
        "select reason_codes from public.anticheat_event_subjects where event_id=$1",
        [historic]
      )
    ).rows.every(
      row =>
        !row.reason_codes.includes("NEW_ACCOUNT_ECONOMIC_ACTIVITY") &&
        !row.reason_codes.includes("REPEATED_TRADE_PAIR")
    )
  );

  await assert.rejects(
    db.query("update public.anticheat_events set amount=0 where id=$1", [
      accepted[0].id
    ]),
    /ANTICHEAT_LEDGER_IMMUTABLE/
  );
  await assert.rejects(
    db.query("delete from public.anticheat_event_subjects where event_id=$1", [
      accepted[0].id
    ]),
    /ANTICHEAT_LEDGER_IMMUTABLE/
  );

  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  const asRole = async (role, user, sql, params = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec(`set role ${role}`);
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role");
    }
  };
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const table of [
      "anticheat_events",
      "anticheat_event_subjects",
      "anticheat_cases"
    ]) {
      await assert.rejects(
        asRole(role, source, `select * from public.${table}`),
        /permission denied/
      );
    }
    await assert.rejects(
      asRole(
        role,
        source,
        "select public.record_anticheat_event('account_registered',$1,null,null)",
        [source]
      ),
      /permission denied/
    );
  }
  await assert.rejects(
    asRole(
      "authenticated",
      source,
      "select public.admin_list_anticheat_cases()"
    ),
    /ADMIN_REQUIRED/
  );
  await assert.rejects(
    asRole(
      "authenticated",
      source,
      "select public.admin_list_anticheat_events()"
    ),
    /ADMIN_REQUIRED/
  );
  const cases = (
    await asRole(
      "authenticated",
      admin,
      "select public.admin_list_anticheat_cases('SignalRecipient') value"
    )
  ).rows[0].value;
  assert.equal(cases.total, 1);
  assert.equal(cases.cases[0].userId, recipient);
  assert.equal(cases.cases[0].severity, "critical");
  const events = (
    await asRole(
      "authenticated",
      admin,
      "select public.admin_list_anticheat_events($1,'trade_accepted',1) value",
      [recipient]
    )
  ).rows[0].value;
  assert.equal(events.total, 5);
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].type, "trade_accepted");
  assert.ok(
    events.events[0].subjects.some(subject => subject.userId === recipient)
  );
});

test("auction and referral triggers preserve evidence and score their repeated activity", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const seller = "ac200000-0000-4000-8000-000000000001";
  const bidder = "ac200000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [seller, "EvidenceSeller"],
    [bidder, "EvidenceBidder"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  const card = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,rarete_base,image_url) values('test','evidence','Evidence','ANIME/MANGA','SSR','https://example.test/evidence.png') returning id"
    )
  ).rows[0].id;
  const instance = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'SSR') returning id",
      [seller, card]
    )
  ).rows[0].id;
  const auction = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at) values($1,$2,10,10,60,now()+interval '1 hour') returning id",
      [instance, seller]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount) values($1,$2,6000)",
    [auction, bidder]
  );
  await db.query(
    "update public.auctions set buyer_id=$2,current_price=6000,status='sold' where id=$1",
    [auction, bidder]
  );
  const saleEvents = (
    await db.query(
      "select event_type,actor_user_id,counterparty_user_id,amount from public.anticheat_events where subject_id=$1 order by id",
      [auction]
    )
  ).rows;
  assert.deepEqual(saleEvents, [
    {
      event_type: "auction_created",
      actor_user_id: seller,
      counterparty_user_id: null,
      amount: 10
    },
    {
      event_type: "auction_bid",
      actor_user_id: bidder,
      counterparty_user_id: seller,
      amount: 6000
    },
    {
      event_type: "auction_sold",
      actor_user_id: seller,
      counterparty_user_id: bidder,
      amount: 6000
    }
  ]);
  assert.ok(
    (
      await db.query(
        "select reason_codes from public.anticheat_event_subjects s join public.anticheat_events e on e.id=s.event_id where e.event_type='auction_bid' and s.user_id=$1",
        [bidder]
      )
    ).rows[0].reason_codes.includes("EXTREME_AUCTION_BID")
  );

  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    seller
  ]);
  const code = (await db.query("select public.create_referral_code() value"))
    .rows[0].value;
  for (let i = 3; i <= 5; i++) {
    const id = `ac200000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [
        id,
        JSON.stringify({ pseudo: `EvidenceReferral${i}`, referral_code: code })
      ]
    );
    await db.query(
      "update auth.users set email_confirmed_at=clock_timestamp() where id=$1",
      [id]
    );
    await db.query(
      "update auth.users set email_confirmed_at=clock_timestamp() where id=$1",
      [id]
    );
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::integer total from public.anticheat_events where event_type='referral_rewarded'"
      )
    ).rows[0].total,
    3
  );
  const lastReward = (
    await db.query(
      "select s.risk_points,s.reason_codes from public.anticheat_event_subjects s join public.anticheat_events e on e.id=s.event_id where e.event_type='referral_rewarded' and s.user_id=$1 order by e.id desc limit 1",
      [seller]
    )
  ).rows[0];
  assert.deepEqual(lastReward, {
    risk_points: 20,
    reason_codes: ["REFERRAL_REWARD_BURST"]
  });
});
