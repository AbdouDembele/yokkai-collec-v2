import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("deleted smurfs: exact historical recovery preserves buyers, requires evidence and never recreates accounts", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column email text, add column banned_until timestamptz"
  );
  const smurf = "ac500000-0000-4000-8000-000000000001";
  const legacySmurf = "ac500000-0000-4000-8000-000000000002";
  const primary = "ac500000-0000-4000-8000-000000000003";
  const admin = "ac500000-0000-4000-8000-000000000004";
  const buyer = "ac500000-0000-4000-8000-000000000005";
  for (const [id, pseudo] of [
    [smurf, "DeletedSource"],
    [legacySmurf, "LegacyDeletedSource"],
    [primary, "HistoricalPrimary"],
    [admin, "HistoricalAdmin"],
    [buyer, "InnocentBuyer"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query("insert into public.admin_users(user_id) values($1)", [admin]);
  for (const other of [smurf, legacySmurf, buyer])
    await db.query(
      "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
      [primary, other]
    );
  await db.query(
    "update public.user_profiles set karas_balance=1000 where user_id=$1",
    [primary]
  );
  const card = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('manual','deleted-smurf','Fixture','TEST','TEST','C','https://example.invalid/card.png') returning id"
    )
  ).rows[0].id;
  const copy = async owner =>
    (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'C') returning id",
        [owner, card]
      )
    ).rows[0].id;
  const owned = await copy(primary),
    sold = await copy(buyer),
    legacyOwned = await copy(primary),
    legitimate = await copy(primary);
  const trade = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,requested_karas,status) values($1,$2,array[$3,$4]::uuid[],300,20,'pending') returning id",
      [smurf, primary, owned, sold]
    )
  ).rows[0].id;
  await db.query(
    "update public.trade_offers set status='accepted',updated_at=clock_timestamp() where id=$1",
    [trade]
  );
  // This fixture predates anti-cheat observability: no accepted-pair event was
  // captured. The real deletion pipeline below still preserves its anonymous trade.
  await db.exec(
    "alter table public.trade_offers disable trigger capture_trade_anticheat_event"
  );
  const legacy = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,requested_card_ids,requested_karas,offered_karas,status) values($1,$2,array[$3]::uuid[],50,10,'accepted') returning id",
      [primary, legacySmurf, legacyOwned]
    )
  ).rows[0].id;
  await db.exec(
    "alter table public.trade_offers enable trigger capture_trade_anticheat_event"
  );
  const live = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_karas,status) values($1,$2,5,'accepted') returning id",
      [primary, buyer]
    )
  ).rows[0].id;
  // The same instance can make a round trip before its single sale. Separate
  // historical recovery batches must still confiscate that sale only once.
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_card_ids,status) values($1,$2,array[$3]::uuid[],'accepted')",
    [primary, smurf, sold]
  );
  const regift = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,status) values($1,$2,array[$3]::uuid[],15,'accepted') returning id",
      [smurf, primary, sold]
    )
  ).rows[0].id;
  const sale = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,status) values($1,$2,$3,10,200,15,now(),'sold') returning id",
      [sold, primary, buyer]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,created_at,status) values($1,$2,$3,10,800,15,now()-interval '2 days',now()-interval '2 days','sold')",
    [sold, primary, buyer]
  );
  for (const id of [smurf, legacySmurf]) {
    await db.exec("set role service_role");
    await db.query("select public.begin_account_deletion($1)", [id]);
    await db.query("select public.prepare_account_deletion($1)", [id]);
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [id]);
  }
  assert.equal(
    (
      await db.query("select from_user from public.trade_offers where id=$1", [
        trade
      ])
    ).rows[0].from_user,
    null
  );
  assert.equal(
    (
      await db.query("select to_user from public.trade_offers where id=$1", [
        legacy
      ])
    ).rows[0].to_user,
    null
  );
  const asUser = async (user, sql, args = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    try {
      return await db.query(sql, args);
    } finally {
      await db.exec("reset role");
    }
  };
  const preview = async ids =>
    (
      await asUser(
        admin,
        "select public.admin_preview_deleted_smurf_recovery($1,$2) value",
        [primary, ids]
      )
    ).rows[0].value;
  const apply = async (
    ids,
    note = "Confirmed historical abuse using independently reviewed evidence.",
    reference = "Reviewed audit case HIST-42 and verified transaction archive.",
    confirmation = primary
  ) =>
    asUser(
      admin,
      "select public.admin_apply_deleted_smurf_recovery($1,$2,$3,$4,$5) value",
      [primary, ids, note, reference, confirmation]
    );
  await assert.rejects(
    asUser(buyer, "select public.admin_preview_deleted_smurf_recovery($1,$2)", [
      primary,
      [trade]
    ]),
    /ADMIN_REQUIRED/
  );
  await assert.rejects(
    asUser(
      buyer,
      "select * from public.anticheat_deleted_smurf_trade_scope($1)",
      [primary]
    ),
    { code: "42501" }
  );
  const initial = await preview([trade, legacy]);
  assert.equal(initial.eligible, true);
  assert.equal(initial.candidateCount, 4);
  assert.equal(
    initial.history.trades.find(row => row.id === trade).deletedUserId,
    smurf
  );
  assert.equal(
    initial.history.trades.find(row => row.id === legacy).deletedUserId,
    null
  );
  assert.equal(initial.recovery.cards, 2);
  assert.equal(initial.recovery.tradeKaras, 320);
  assert.equal(initial.recovery.saleKaras, 200);
  assert.equal(initial.recovery.karas, 520);
  assert.deepEqual(initial.recovery.auctionIds, [sale]);
  assert.equal((await preview([live])).eligible, false);
  await assert.rejects(
    apply([trade, live]),
    /DELETED_SMURF_RECOVERY_NOT_ELIGIBLE/
  );
  await assert.rejects(apply([trade, trade]), /INVALID_RECOVERY_TRADES/);
  await assert.rejects(
    apply([trade], "too short", "reference too short but valid"),
    /HISTORICAL_EVIDENCE_REQUIRED/
  );
  await assert.rejects(
    apply([trade], undefined, ""),
    /HISTORICAL_EVIDENCE_REQUIRED/
  );
  await assert.rejects(
    apply([trade], undefined, undefined, smurf),
    /RECOVERY_CONFIRMATION_REQUIRED/
  );
  await db.query("update public.user_cards set is_locked=true where id=$1", [
    owned
  ]);
  assert.equal((await preview([trade])).recovery.blockedCards, 1);
  await assert.rejects(apply([trade]), /DELETED_SMURF_RECOVERY_NOT_ELIGIBLE/);
  await db.query("update public.user_cards set is_locked=false where id=$1", [
    owned
  ]);
  await db.query(
    "update public.user_profiles set karas_balance=519 where user_id=$1",
    [primary]
  );
  await assert.rejects(
    apply([trade, legacy]),
    /DELETED_SMURF_RECOVERY_NOT_ELIGIBLE/
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anticheat_deleted_smurf_recoveries"
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        owned
      ])
    ).rows[0].user_id,
    primary
  );
  await db.query(
    "update public.user_profiles set karas_balance=1000 where user_id=$1",
    [primary]
  );
  await db.query("insert into public.admin_users(user_id) values($1)", [
    primary
  ]);
  assert.equal((await preview([trade])).eligible, false);
  await db.query("delete from public.admin_users where user_id=$1", [primary]);
  const result = (await apply([trade, legacy])).rows[0].value;
  assert.equal(result.cardsRecovered, 2);
  assert.equal(result.karasRecovered, 520);
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [primary]
      )
    ).rows[0].karas_balance,
    480
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.user_cards where id=any($1)",
        [[owned, legacyOwned]]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        sold
      ])
    ).rows[0].user_id,
    buyer
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        legitimate
      ])
    ).rows[0].user_id,
    primary
  );
  for (const table of ["auth.users", "public.user_profiles"])
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from ${table} where ${table === "auth.users" ? "id" : "user_id"}=any($1)`,
          [[smurf, legacySmurf]]
        )
      ).rows[0].n,
      0
    );
  const after = await preview([]);
  assert.equal(after.candidateCount, 2);
  assert.equal(after.receipts[0].history.trades.length, 2);
  assert.equal(after.receipts[0].history.sales[0].id, sale);
  assert.equal(after.receipts[0].recovery.karas, 520);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anticheat_deleted_smurf_recovery_items"
      )
    ).rows[0].n,
    3
  );
  await assert.rejects(
    apply([trade, legacy]),
    /DELETED_SMURF_RECOVERY_NOT_ELIGIBLE/
  );
  const secondPreview = await preview([regift]);
  assert.equal(secondPreview.recovery.saleKaras, 0);
  assert.equal(secondPreview.recovery.saleCount, 0);
  assert.equal(secondPreview.recovery.karas, 15);
  await apply([regift]);
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [primary]
      )
    ).rows[0].karas_balance,
    465
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anticheat_deleted_smurf_recovery_items where kind='auction' and item_id=$1",
        [sale]
      )
    ).rows[0].n,
    1
  );
  for (const table of [
    "public.anticheat_deleted_smurf_recoveries",
    "public.anticheat_deleted_smurf_recovery_items"
  ]) {
    await assert.rejects(
      db.query(`delete from ${table}`),
      /ANTICHEAT_LEDGER_IMMUTABLE/
    );
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        (
          await db.query("select has_table_privilege($1,$2,'SELECT') allowed", [
            role,
            table
          ])
        ).rows[0].allowed,
        false
      );
  }
});
