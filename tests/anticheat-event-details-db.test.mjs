import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
test("event details preserve named card snapshots and exact two-way Karas through deletion, and retain old-event provenance", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column email text, add column banned_until timestamptz"
  );
  const [admin, from, to] = [1, 2, 3].map(
    i => `ac630000-0000-4000-8000-${String(i).padStart(12, "0")}`
  );
  for (const [id, pseudo] of [
    [admin, "EventAdmin"],
    [from, "EventSender"],
    [to, "EventRecipient"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("insert into public.admin_users(user_id)values($1)", [admin]);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')",
    [from, to]
  );
  const card = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)values('manual','event-detail','SATORU GOJO','ANIME/MANGA','JUJUTSU KAISEN','SSR','https://example.invalid/gojo.png')returning id"
    )
  ).rows[0].id;
  const copy = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity)values($1,$2,'SSR')returning id",
      [to, card]
    )
  ).rows[0].id;
  const trade = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,requested_karas,status)values($1,$2,$3,70,5,'accepted')returning id",
      [from, to, [copy]]
    )
  ).rows[0].id;
  const auction = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at,status)values($1,$2,10,10,15,now()+interval '15 minutes','active')returning id",
      [copy, to]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount)values($1,$2,90)",
    [auction, from]
  );
  const read = async (user, type = "") => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          "select public.admin_list_anticheat_events(null,$1,100,0)value",
          [type]
        )
      ).rows[0].value.events;
    } finally {
      await db.exec("reset role");
    }
  };
  await assert.rejects(read(to), /ADMIN_REQUIRED/);
  let events = await read(admin);
  const created = events.find(
    e => e.subjectId === trade && e.type === "trade_created"
  );
  assert.equal(created.detail.source, "captured");
  assert.equal(created.detail.offeredCards[0].name, "SATORU GOJO");
  assert.equal(created.detail.offeredKaras, 70);
  assert.equal(created.detail.requestedKaras, 5);
  const bid = events.find(e => e.type === "auction_bid");
  assert.equal(bid.detail.cards[0].name, "SATORU GOJO");
  assert.equal(bid.detail.amount, 90);
  assert.equal(bid.detail.startingPrice, 10);
  // Future events use immutable snapshots, not the card's later catalogue name.
  await db.query(
    "update public.cards set nom='Later edited name' where id=$1",
    [card]
  );
  events = await read(admin);
  assert.equal(
    events.find(e => e.id === created.id).detail.offeredCards[0].name,
    "SATORU GOJO"
  );
  // Legacy fixture: no snapshot existed when this event was recorded. Its
  // retained-record origin must be explicit; the immutable log is never rewritten.
  await db.exec(
    "alter table public.anticheat_events disable trigger anticheat_capture_event_assets"
  );
  const legacy = (
    await db.query(
      "insert into public.anticheat_events(event_type,actor_user_id,counterparty_user_id,subject_id,amount,card_count,metadata)values('trade_accepted',$1,$2,$3,70,1,$4)returning id",
      [
        from,
        to,
        trade,
        JSON.stringify({
          offeredCards: 1,
          requestedCards: 0,
          offeredKaras: 70,
          requestedKaras: 5
        })
      ]
    )
  ).rows[0].id;
  await db.exec(
    "alter table public.anticheat_events enable trigger anticheat_capture_event_assets"
  );
  assert.equal(
    (await read(admin)).find(e => e.id === Number(legacy)).detail.source,
    "retained"
  );
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec("set role service_role");
  await db.query("select public.begin_account_deletion($1)", [from]);
  await db.query("select public.prepare_account_deletion($1)", [from]);
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1", [from]);
  const after = await read(admin);
  const retained = after.find(e => e.id === created.id).detail;
  assert.equal(retained.fromName, null);
  assert.equal(retained.toName, "EventRecipient");
  assert.equal(retained.offeredCards[0].name, "SATORU GOJO");
  assert.equal(retained.offeredKaras, 70);
  assert.equal(retained.requestedKaras, 5);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin
  ]);
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select public.anticheat_event_asset_detail($1)", [created.id]),
    { code: "42501" }
  );
  await db.exec("reset role");
  const meta = (
    await db.query("select metadata from public.anticheat_events where id=$1", [
      created.id
    ])
  ).rows[0].metadata;
  assert.doesNotMatch(
    JSON.stringify(meta),
    /EventSender|EventRecipient|network_identity|device_identity/
  );
});
