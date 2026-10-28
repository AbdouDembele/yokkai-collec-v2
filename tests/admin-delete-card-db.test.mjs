import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const bidder = "10000000-0000-4000-8000-000000000002";
const admin = "10000000-0000-4000-8000-000000000003";
const card = "20000000-0000-4000-8000-000000000001";
const copies = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002"
];

test("admin_delete_card retire les copies et nettoie atomiquement leurs usages", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());

  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values
      ($1,'{"pseudo":"Owner"}'),
      ($2,'{"pseudo":"Bidder"}'),
      ($3,'{"pseudo":"Admin"}')`,
    [owner, bidder, admin]
  );
  await db.query("insert into public.admin_users(user_id) values ($1)", [
    admin
  ]);
  await db.query(
    "update public.user_profiles set karas_balance=50 where user_id=$1",
    [bidder]
  );
  await db.query(
    `insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
     values ($1,'admin-delete-test','CARTE À SUPPRIMER','ANIME/MANGA','TEST','SR','https://example.test/card.jpg','manual')`,
    [card]
  );
  await db.query(
    `insert into public.user_cards(id,user_id,card_id,rarity) values
     ($1,$3,$5,'SR'),($2,$4,$5,'SR')`,
    [copies[0], copies[1], owner, bidder, card]
  );

  const auction = (
    await db.query(
      `insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,status,current_price,buyer_id)
       values ($1,$2,10,60,now()+interval '1 hour','active',30,$3) returning id`,
      [copies[0], owner, bidder]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,30)",
    [auction, bidder]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted')",
    [owner, bidder]
  );
  await db.query(
    `insert into public.trade_offers(from_user,to_user,offered_card_ids)
     values ($1,$2,$3::uuid[])`,
    [owner, bidder, [copies[1]]]
  );
  const pack = (
    await db.query(
      "insert into public.decision_packs(user_id,status) values ($1,'pending') returning id",
      [owner]
    )
  ).rows[0].id;
  const choice = (
    await db.query(
      `insert into public.decision_pack_choices(pack_id,card_id,rarity,position)
       values ($1,$2,'SR',1) returning id`,
      [pack, card]
    )
  ).rows[0].id;
  await db.query(
    "update public.decision_packs set status='claimed',kept_choice_id=$2 where id=$1",
    [pack, choice]
  );
  await db.query(
    `insert into public.card_shares(id,card_id,owner_id,card_name,franchise,rarity,shiny,show_pseudo,catalogue_image_url)
     values ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$1,$2,'CARTE À SUPPRIMER','TEST','SR',false,false,'https://example.test/card.jpg')`,
    [card, owner]
  );
  await db.query(
    "update public.user_profiles set banner_card_id=$2,featured_card_ids=$3::uuid[] where user_id=$1",
    [owner, card, copies]
  );

  const as = async (userId, sql, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      userId
    ]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec("reset role");
    }
  };

  await assert.rejects(
    as(owner, "select public.admin_delete_card($1)", [card]),
    /ADMIN_REQUIRED/
  );
  const result = (
    await as(admin, "select public.admin_delete_card($1) value", [card])
  )[0].value;

  assert.deepEqual(result, {
    name: "CARTE À SUPPRIMER",
    ownedCopiesRemoved: 2,
    decisionChoicesRemoved: 1,
    auctionsCancelled: 1,
    pendingTradesDeclined: 1
  });
  assert.equal(
    (
      await db.query("select count(*) total from public.cards where id=$1", [
        card
      ])
    ).rows[0].total,
    0
  );
  assert.equal(
    (
      await db.query(
        "select count(*) total from public.user_cards where card_id=$1",
        [card]
      )
    ).rows[0].total,
    0
  );
  assert.equal(
    (
      await db.query("select count(*) total from public.auctions where id=$1", [
        auction
      ])
    ).rows[0].total,
    0
  );
  assert.equal(
    (
      await db.query(
        "select count(*) total from public.bids where auction_id=$1",
        [auction]
      )
    ).rows[0].total,
    0
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [bidder]
      )
    ).rows[0].karas_balance,
    80
  );
  assert.equal(
    (await db.query("select status from public.trade_offers")).rows[0].status,
    "declined"
  );
  assert.deepEqual(
    (
      await db.query(
        "select banner_card_id,featured_card_ids from public.user_profiles where user_id=$1",
        [owner]
      )
    ).rows[0],
    {
      banner_card_id: null,
      featured_card_ids: []
    }
  );
  assert.equal(
    (
      await db.query(
        "select kept_choice_id from public.decision_packs where id=$1",
        [pack]
      )
    ).rows[0].kept_choice_id,
    null
  );
  const audit = (
    await db.query(
      "select action,metadata from public.admin_audit_logs where card_id=$1",
      [card]
    )
  ).rows[0];
  assert.equal(audit.action, "card.delete");
  assert.equal(audit.metadata.owned_copies_removed, 2);
});
