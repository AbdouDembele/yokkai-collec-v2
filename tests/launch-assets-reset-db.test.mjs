import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import {
  launchAssetsResetSQL,
  launchInventorySQL
} from "../scripts/admin/launch-assets-reset.mjs";

const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture(t) {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const n of [1, 2])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: `Launch${n}` })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [id(2)]);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [id(1), id(2)]
  );
  for (const n of [10, 11, 12])
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,'Launch card','ANIME/MANGA','Launch license','LR','https://i.imgur.com/card.png','manual')",
      [id(n), `launch-${n}`]
    );
  for (const [n, owner, card, locked] of [
    [20, 1, 10, true],
    [21, 2, 11, false],
    [22, 2, 10, false]
  ])
    await db.query(
      "insert into public.user_cards(id,user_id,card_id,rarity,is_locked,custom_image_url) values($1,$2,$3,'LR',$4,'https://i.imgur.com/custom.png')",
      [id(n), id(owner), id(card), locked]
    );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values($1,$2),($3,$4)",
    [id(1), id(11), id(2), id(11)]
  );
  await db.query(
    "update public.user_profiles set karas_balance=123,featured_card_ids=array[$1::uuid],banner_card_id=$2 where user_id=$3",
    [id(20), id(10), id(1)]
  );
  await db.query(
    "update public.user_profiles set karas_balance=456,bonus_regular_packs=7,featured_card_ids=array[$1::uuid],bio='Keep this profile' where user_id=$2",
    [id(22), id(2)]
  );
  // Historical stale selection: this player never owned this catalogue card.
  await db.query(
    "update public.user_profiles set banner_card_id=$1 where user_id=$2",
    [id(12), id(2)]
  );
  for (const [n, status] of [
    [30, "active"],
    [31, "sold"]
  ])
    await db.query(
      "insert into public.auctions(id,card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,status) values($1,$2,$3,$4,10,20,60,now()+interval '1 hour',$5)",
      [id(n), id(21), id(2), id(1), status]
    );
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount) values($1,$2,20),($3,$2,20)",
    [id(30), id(1), id(31)]
  );
  for (const [n, status] of [
    [40, "pending"],
    [41, "accepted"]
  ])
    await db.query(
      "insert into public.trade_offers(id,from_user,to_user,offered_card_ids,offered_karas,status) values($1,$2,$3,array[$4::uuid],10,$5)",
      [id(n), id(2), id(1), id(22), status]
    );
  for (const [n, owner, status] of [
    [50, 1, "pending"],
    [51, 2, "claimed"]
  ]) {
    await db.query(
      "insert into public.decision_packs(id,user_id,status) values($1,$2,$3)",
      [id(n), id(owner), status]
    );
    await db.query(
      "insert into public.decision_pack_choices(id,pack_id,card_id,rarity,position) values($1,$2,$3,'LR',1)",
      [id(n + 10), id(n), id(10)]
    );
  }
  await db.exec("set constraints all immediate");
  const inventory = async () =>
    (await db.query(launchInventorySQL)).rows[0].snapshot;
  return { db, inventory };
}

test("launch reset defaults to rollback and preserves all assets during rehearsal", async t => {
  const { db, inventory } = await fixture(t);
  const before = await inventory();
  assert.equal(before.cards, 3);
  assert.equal(before.lockedCards, 1);
  assert.equal(before.escrowKaras, 20);
  await db.exec(launchAssetsResetSQL(before));
  assert.deepEqual(await inventory(), before);
  assert.equal(
    (await db.query("select count(*)::int n from public.bids")).rows[0].n,
    2
  );
});

test("launch reset removes every player's assets including admins, preserves identity/wishlists/catalogue/history and cannot resurrect escrow", async t => {
  const { db, inventory } = await fixture(t);
  const before = await inventory();
  const preserved = async table =>
    (
      await db.query(
        `select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`
      )
    ).rows;
  const accounts = await preserved("auth.users"),
    wishlists = await preserved("public.wishlists"),
    catalogue = await preserved("public.cards");
  const sale = (
    await db.query(
      "select to_jsonb(a)-'card_instance_id' row from public.auctions a where id=$1",
      [id(31)]
    )
  ).rows;
  await db.exec(launchAssetsResetSQL(before, { commit: true }));
  const after = await inventory();
  for (const key of [
    "cards",
    "lockedCards",
    "karas",
    "activeAuctions",
    "escrowKaras",
    "pendingTrades",
    "pendingDecisionPacks"
  ])
    assert.equal(after[key], 0, key);
  assert.deepEqual(await preserved("auth.users"), accounts);
  assert.deepEqual(await preserved("public.wishlists"), wishlists);
  assert.deepEqual(await preserved("public.cards"), catalogue);
  assert.equal(
    (await db.query("select count(*)::int n from public.admin_users")).rows[0]
      .n,
    1
  );
  assert.deepEqual(
    (
      await db.query(
        "select to_jsonb(a)-'card_instance_id' row from public.auctions a where id=$1",
        [id(31)]
      )
    ).rows,
    sale
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.bids")).rows[0].n,
    1
  );
  assert.equal(
    (
      await db.query("select status from public.trade_offers where id=$1", [
        id(40)
      ])
    ).rows[0].status,
    "cancelled"
  );
  assert.equal(
    (
      await db.query("select status from public.trade_offers where id=$1", [
        id(41)
      ])
    ).rows[0].status,
    "accepted"
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.decision_pack_choices"))
      .rows[0].n,
    1
  );
  const profiles = (
    await db.query(
      "select karas_balance,featured_card_ids,banner_card_id,bonus_regular_packs,bio from public.user_profiles order by user_id"
    )
  ).rows;
  assert.equal(profiles[1].bonus_regular_packs, 7);
  assert.equal(profiles[1].bio, "Keep this profile");
  for (const p of profiles) {
    assert.equal(p.karas_balance, 0);
    assert.deepEqual(p.featured_card_ids, []);
    assert.equal(p.banner_card_id, null);
  }
  await db.exec("select public.settle_expired_auctions()");
  assert.equal((await inventory()).karas, 0);
  await db.exec(launchAssetsResetSQL(await inventory(), { commit: true }));
  assert.deepEqual(await preserved("public.wishlists"), wishlists);
});

test("changed inventories and player connections abort before any reset", async t => {
  const { db, inventory } = await fixture(t);
  const before = await inventory();
  await assert.rejects(
    db.exec(
      launchAssetsResetSQL(
        { ...before, cards: before.cards + 1 },
        { commit: true }
      )
    ),
    /LAUNCH_RESET_INVENTORY_CHANGED/
  );
  await db.exec("rollback");
  assert.deepEqual(await inventory(), before);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(1)
  ]);
  await assert.rejects(
    db.exec(launchAssetsResetSQL(before, { commit: true })),
    /OPERATOR_CONNECTION_REQUIRED/
  );
  await db.exec(
    "rollback; select set_config('request.jwt.claim.sub','',false)"
  );
  assert.deepEqual(await inventory(), before);
});

test("incomplete or injectable manifests are rejected before producing SQL", () => {
  for (const invalid of [null, {}, { accounts: "0;delete" }, { accounts: -1 }])
    assert.throws(() => launchAssetsResetSQL(invalid), /inventory/);
});
