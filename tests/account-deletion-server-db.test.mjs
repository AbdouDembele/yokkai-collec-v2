import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const removed = "10000000-0000-4000-8000-000000000001";
const survivor = "10000000-0000-4000-8000-000000000002";
const other = "10000000-0000-4000-8000-000000000003";
const card = "20000000-0000-4000-8000-000000000001";

test("server deletion refunds once, preserves anonymous histories, fences old JWTs and keeps Auth deletion outside SQL", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column email text, add column banned_until timestamptz"
  );
  await db.query(
    `insert into auth.users(id,raw_user_meta_data,email) values
    ($1,'{"pseudo":"EraseMe"}','erase@example.test'),($2,'{"pseudo":"Survivor"}','survivor@example.test'),($3,'{"pseudo":"Other"}','other@example.test')`,
    [removed, survivor, other]
  );
  await db.exec("update public.user_profiles set karas_balance=1000");
  await db.query(
    `insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values ($1,'erase-card','CARD','ANIME/MANGA','TEST','C','https://example.test/card.jpg','manual')`,
    [card]
  );
  const owned = await db.query(
    `insert into public.user_cards(user_id,card_id,rarity) values ($1,$3,'C'),($2,$3,'C') returning id,user_id`,
    [removed, other, card]
  );
  const removedCard = owned.rows.find(r => r.user_id === removed).id;
  const otherCard = owned.rows.find(r => r.user_id === other).id;
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity,is_locked) values ($1,$2,'C',true)",
    [removed, card]
  );
  const sale = await db.query(
    `insert into public.auctions(card_instance_id,seller_id,buyer_id,current_price,starting_price,duration_minutes,ends_at)
    values ($1,$2,$3,40,10,60,now()+interval '1 hour') returning id`,
    [removedCard, removed, survivor]
  );
  const bidding = await db.query(
    `insert into public.auctions(card_instance_id,seller_id,buyer_id,current_price,starting_price,duration_minutes,ends_at)
    values ($1,$2,$3,30,10,60,now()+interval '1 minute') returning id`,
    [otherCard, other, removed]
  );
  const won = await db.query(
    "insert into public.auctions(card_instance_id,seller_id,buyer_id,current_price,starting_price,duration_minutes,ends_at,status) values ($1,$2,$3,20,10,60,now()-interval '1 hour','sold') returning id",
    [otherCard, other, removed]
  );
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,20),($1,$3,10)",
    [won.rows[0].id, removed, survivor]
  );
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,40),($3,$4,30)",
    [sale.rows[0].id, survivor, bidding.rows[0].id, removed]
  );
  await db.query(
    "update public.user_profiles set karas_balance=karas_balance-40 where user_id=$1",
    [survivor]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted')",
    [removed, survivor]
  );
  await db.query(
    `insert into public.trade_offers(from_user,to_user,offered_karas,status) values ($1,$2,10,'accepted'),($2,$1,10,'pending')`,
    [removed, survivor]
  );
  await db.query(
    `insert into public.user_reports(reporter_id,reported_id,reason,context_type,snapshot,details)
    values ($1,$2,'spam','profile','{"pseudo":"EraseMe","email":"erase@example.test"}','EraseMe private text')`,
    [survivor, removed]
  );
  await db.query(
    `insert into public.admin_audit_logs(admin_user_id,action,metadata) values ($1,'player.ban',jsonb_build_object('target_user_id',$2::text,'pseudo','EraseMe'))`,
    [other, removed]
  );
  await db.query(
    `insert into storage.objects(bucket_id,name,owner_id) values ('avatars',$1,$2)`,
    [`${removed}/avatar.png`, removed]
  );
  await db.query(
    "insert into public.folders(user_id,nom) values ($1,'Private folder')",
    [removed]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values ($1,$2)",
    [removed, card]
  );
  // Supabase's platform supplies Storage table privileges; the minimal bootstrap does not.
  // Direct Storage writes require Pro once the paid-entitlement migration is
  // present. Keep this scenario's deletion/fencing assertions unchanged.
  if (
    (
      await db.query(
        "select to_regprocedure('public.billing_set_entitlement_scope(text,boolean)') present"
      )
    ).rows[0].present
  ) {
    const scope = "test:acct_deletion:price_deletion";
    await db.query("select public.billing_set_entitlement_scope($1,true)", [
      scope
    ]);
    await db.query(
      "insert into public.billing_accounts(user_id,scope,active,status,period_end,verified_at) values($1,$2,true,'active',clock_timestamp()+interval '1 month',clock_timestamp())",
      [removed, scope]
    );
  }
  await db.exec(
    "grant select,insert,update,delete on storage.objects to authenticated; set role authenticated"
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    removed
  ]);
  // Direct avatars writes are closed (#376): probe the bucket players still write.
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values ('profile-wall-media',$1,$2)",
    [`${removed}/00000000-0000-4000-8000-0000000000aa.png`, removed]
  );
  await db.query("delete from storage.objects where name=$1", [
    `${removed}/00000000-0000-4000-8000-0000000000aa.png`
  ]);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");

  // RED on master: neither trusted service RPC exists yet.
  await db.exec("set role service_role");
  await db.query("select public.begin_account_deletion($1)", [removed]);
  const first = (
    await db.query("select public.prepare_account_deletion($1) as value", [
      removed
    ])
  ).rows[0].value;
  const second = (
    await db.query("select public.prepare_account_deletion($1) as value", [
      removed
    ])
  ).rows[0].value;
  assert.deepEqual(first, second);
  assert.deepEqual(first, [
    { bucket: "avatars", name: `${removed}/avatar.png` }
  ]);
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [survivor]
      )
    ).rows[0].karas_balance,
    1000
  );
  assert.equal(
    (
      await db.query("select count(*)::int n from auth.users where id=$1", [
        removed
      ])
    ).rows[0].n,
    1
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.user_profiles where user_id=$1",
        [removed]
      )
    ).rows[0].n,
    0
  );
  for (const table of [
    "user_cards",
    "folders",
    "wishlists",
    "user_achievements",
    "user_achievement_stats",
    "friendships"
  ]) {
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from public.${table} where user_id=$1`,
          [removed]
        )
      ).rows[0].n,
      0,
      table
    );
  }
  const reset = (
    await db.query(
      "select buyer_id,current_price,status,ends_at>now()+interval '3 minutes' extended from public.auctions where id=$1",
      [bidding.rows[0].id]
    )
  ).rows[0];
  assert.deepEqual(reset, {
    buyer_id: null,
    current_price: 10,
    status: "active",
    extended: true
  });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.bids where auction_id=$1 and bidder_id=$2",
        [bidding.rows[0].id, removed]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.trade_offers where status='cancelled'"
      )
    ).rows[0].n,
    1
  );
  assert.deepEqual(
    (await db.query("select snapshot,details from public.user_reports")).rows,
    [{ snapshot: {}, details: "" }]
  );
  assert.deepEqual(
    (await db.query("select metadata from public.admin_audit_logs")).rows,
    [{ metadata: {} }]
  );
  assert.equal(
    (await db.query("select count(*)::int n from storage.objects")).rows[0].n,
    1,
    "Storage metadata is removed by its API, never by SQL"
  );
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select public.begin_account_deletion($1)", [other]),
      e => e.code === "42501"
    );
    await assert.rejects(
      db.query("select public.prepare_account_deletion($1)", [other]),
      e => e.code === "42501"
    );
    await db.exec("reset role");
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    removed
  ]);
  await assert.rejects(
    db.query("select public.open_regular_pack()"),
    /PROFILE_MISSING/
  );
  await assert.rejects(
    db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'C')",
      [removed, card]
    ),
    e => e.code === "42501"
  );
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values ('avatars',$1,$2)",
      [`${removed}/again.png`, removed]
    ),
    /ACCOUNT_DELETED/
  );
  // Every bucket a player can still write directly is fenced too (#376).
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name,owner_id) values ('profile-wall-media',$1,$2)",
      [`${removed}/00000000-0000-4000-8000-0000000000ab.png`, removed]
    ),
    /ACCOUNT_DELETED/
  );
  // avatars is written only by /api/profile-media: its service_role
  // reservation is refused before any byte reaches Storage.
  await db.exec("reset role; set role service_role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(
    db.query(
      "insert into public.profile_media_assets(path,user_id,purpose,mime_type,animated,public_url) values($1,$2,'avatar','image/png',false,$3)",
      [
        `${removed}/avatar-00000000-0000-4000-8000-0000000000ac.png`,
        removed,
        `https://api.yokkai-collec.com/storage/v1/object/public/avatars/${removed}/avatar-00000000-0000-4000-8000-0000000000ac.png`
      ]
    ),
    /ACCOUNT_DELETED/
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  // Disposable FK simulation only. Production uses auth.admin.deleteUser(id,false).
  await db.query("delete from auth.users where id=$1", [removed]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    survivor
  ]);
  const detail = (
    await db.query("select public.get_auction($1) v", [sale.rows[0].id])
  ).rows[0].v;
  assert.equal(detail.seller, "Joueur supprimé");
  assert.equal(detail.sellerId, null);
  assert.equal(detail.card.name, "CARD");
  const historical = (
    await db.query("select public.get_auction($1) v", [won.rows[0].id])
  ).rows[0].v;
  assert.equal(historical.status, "sold");
  assert.equal(historical.buyerId, null);
  assert.equal(historical.winner, "Joueur supprimé");
  assert.ok(historical.history.some(bid => bid.name === "Joueur supprimé"));
  for (const rpc of ["list_trade_offers", "list_trade_offers_page"]) {
    const v = (await db.query(`select public.${rpc}() v`)).rows[0].v;
    const offers = Array.isArray(v) ? v : v.items;
    assert.equal(offers.length, 2);
    assert.ok(
      offers.every(
        o =>
          o.fromPseudo === "Joueur supprimé" || o.toPseudo === "Joueur supprimé"
      )
    );
  }
  for (const rpc of ["list_auctions", "list_auctions_page"]) {
    const v = (await db.query(`select public.${rpc}() v`)).rows[0].v;
    const auctions = Array.isArray(v) ? v : v.items;
    assert.ok(
      auctions.some(
        a => a.id === sale.rows[0].id && a.seller === "Joueur supprimé"
      )
    );
  }
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.account_deletion_log where user_id=$1",
        [removed]
      )
    ).rows[0].n,
    1
  );
  await db.query("insert into public.admin_users(user_id) values ($1)", [
    other
  ]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other
  ]);
  const reports = (await db.query("select public.admin_search_reports() v"))
    .rows[0].v;
  assert.equal(reports.total, 1);
  assert.equal(reports.reports[0].reportedPseudo, "Deleted player");
  assert.equal(reports.reports[0].reportedId, null);
  assert.equal(reports.reports[0].reportedEmail, "");
});

test("a non-avatar Storage asset fails closed before the tombstone or any cleanup", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"AssetOwner"}\')',
    [removed]
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values ('cards','catalogue.jpg',$1)",
    [removed]
  );
  await db.exec("set role service_role");
  await assert.rejects(
    db.query("select public.prepare_account_deletion($1)", [removed]),
    /ACCOUNT_DELETION_NOT_STARTED/
  );
  await assert.rejects(
    db.query("select public.begin_account_deletion($1)", [removed]),
    /STORAGE_OWNERSHIP_REQUIRES_REVIEW/
  );
  await db.exec("reset role");
  assert.equal(
    (await db.query("select count(*)::int n from public.account_deletion_log"))
      .rows[0].n,
    0
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.user_profiles")).rows[0]
      .n,
    1
  );
  assert.equal(
    (await db.query("select count(*)::int n from storage.objects")).rows[0].n,
    1
  );
});
