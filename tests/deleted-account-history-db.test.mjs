import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import fs from "node:fs";
test("deleted identity history is admin-only for 90 days; multi-source trade/auction recovery is exact and never double-counts resales", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column email text,add column banned_until timestamptz"
  );
  const [admin, primary, a, b, buyer, live] = [1, 2, 3, 4, 5, 6].map(
    i => `ac640000-0000-4000-8000-${String(i).padStart(12, "0")}`
  );
  for (const [id, pseudo] of [
    [admin, "ArchiveAdmin"],
    [primary, "ArchiveMain"],
    [a, "FormerAlpha"],
    [b, "FormerBeta"],
    [buyer, "ThirdParty"],
    [live, "StillAlive"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email)values($1,$2,$3)",
      [
        id,
        JSON.stringify({ pseudo }),
        `${pseudo.toLowerCase()}@example.invalid`
      ]
    );
  await db.query("insert into public.admin_users(user_id)values($1)", [admin]);
  await db.query(
    "update public.user_profiles set karas_balance=2000 where user_id=$1",
    [primary]
  );
  for (const source of [a, b, buyer, live])
    await db.query(
      "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')",
      [primary, source]
    );
  const catalog = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)values('manual','archive','BROLY','ANIME/MANGA','Dragon Ball','LR','https://example.invalid/broly.png')returning id"
    )
  ).rows[0].id;
  const copy = async user =>
    (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity)values($1,$2,'LR')returning id",
        [user, catalog]
      )
    ).rows[0].id;
  const ownedA = await copy(primary),
    ownedB = await copy(primary),
    resoldThird = await copy(buyer),
    resoldSource = await copy(b),
    legitimate = await copy(primary);
  const trade = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,requested_karas,status)values($1,$2,$3,700,100,'accepted')returning id",
      [a, primary, [ownedA, resoldThird, resoldSource]]
    )
  ).rows[0].id;
  const auction = async (card, seller, winner, price, status = "sold") =>
    (
      await db.query(
        "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,status)values($1,$2,$3,10,$4,15,now(),$5)returning id",
        [card, seller, winner, price, status]
      )
    ).rows[0].id;
  const buy = await auction(ownedB, b, primary, 10),
    sellSource = await auction(resoldSource, primary, b, 300),
    sellThird = await auction(resoldThird, primary, buyer, 200);
  const pending = (
    await db.query(
      "insert into public.trade_offers(from_user,to_user,offered_card_ids,status)values($1,$2,$3,'pending')returning id",
      [primary, buyer, [ownedA]]
    )
  ).rows[0].id;
  await db.query("update public.user_cards set is_locked=true where id=$1", [
    ownedA
  ]);
  const active = await auction(ownedB, primary, buyer, 100, "active");
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount)values($1,$2,100)",
    [active, buyer]
  );
  await db.query(
    "update public.user_profiles set karas_balance=900 where user_id=$1",
    [buyer]
  );
  for (const source of [a, b]) {
    await db.exec("set role service_role");
    await db.query("select public.begin_account_deletion($1)", [source]);
    await db.query("select public.prepare_account_deletion($1)", [source]);
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [source]);
  }
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
  const list = async (query = "", related = true) =>
    (
      await asUser(
        admin,
        "select public.admin_list_deleted_accounts($1,$2,$3,30,0)value",
        [query, primary, related]
      )
    ).rows[0].value;
  const preview = async (sources = [a, b]) =>
    (
      await asUser(
        admin,
        "select public.admin_preview_deleted_account_sanction($1,$2)value",
        [primary, sources]
      )
    ).rows[0].value;
  const apply = async (
    sources,
    token,
    note = "Verified both deleted sources against the full economic evidence.",
    confirmation = primary
  ) =>
    (
      await asUser(
        admin,
        "select public.admin_apply_deleted_account_sanction($1,$2,$3,$4,$5)value",
        [primary, sources, note, confirmation, token]
      )
    ).rows[0].value;
  await assert.rejects(
    asUser(
      buyer,
      "select public.admin_list_deleted_accounts($1,$2,true,30,0)",
      ["", primary]
    ),
    /ADMIN_REQUIRED/
  );
  for (const table of [
    "anticheat_deleted_accounts",
    "anticheat_deleted_account_transfers",
    "anticheat_deleted_account_sanctions",
    "anticheat_deleted_account_claims"
  ])
    await assert.rejects(asUser(buyer, `select*from public.${table}`), {
      code: "42501"
    });
  const records = await list();
  assert.equal(records.total, 2);
  assert.equal(
    records.accounts.find(x => x.userId === a).pseudo,
    "FormerAlpha"
  );
  assert.equal(
    records.accounts.find(x => x.userId === a).email,
    "formeralpha@example.invalid"
  );
  assert.equal(
    (await list("FORMERBETA@EXAMPLE.INVALID")).accounts[0].userId,
    b
  );
  assert.equal((await list("StillAlive", false)).total, 0);
  assert.equal((await list()).accounts.find(x => x.userId === b).transfers, 2);
  const initial = await preview();
  assert.equal(initial.eligible, true);
  assert.equal(initial.recovery.cards, 2);
  assert.equal(initial.recovery.transferKaras, 890);
  assert.equal(initial.recovery.saleKaras, 200);
  assert.equal(initial.recovery.karas, 1090);
  assert.equal(initial.history.sales[0].id, sellThird);
  assert.ok(!initial.history.sales.some(x => x.id === sellSource));
  assert.equal(initial.history.transfers.length, 3);
  await assert.rejects(preview([a, a]), /INVALID_DELETED_ACCOUNTS/);
  assert.equal((await preview([live])).eligible, false);
  await assert.rejects(apply([a, b], "stale"), /SANCTION_PREVIEW_CHANGED/);
  await assert.rejects(
    apply([a, b], initial.previewToken, "short"),
    /INVALID_SANCTION_NOTE/
  );
  await assert.rejects(
    apply([a, b], initial.previewToken, undefined, a),
    /SANCTION_CONFIRMATION_REQUIRED/
  );
  await db.query(
    "update public.user_profiles set karas_balance=100 where user_id=$1",
    [primary]
  );
  assert.equal((await preview()).eligible, false);
  await assert.rejects(
    apply([a, b], initial.previewToken),
    /DELETED_ACCOUNTS_NOT_ELIGIBLE/
  );
  assert.equal(
    (await db.query("select status from public.auctions where id=$1", [active]))
      .rows[0].status,
    "active"
  );
  await db.query(
    "update public.user_profiles set karas_balance=2000 where user_id=$1",
    [primary]
  );
  const done = await apply([a, b], (await preview()).previewToken);
  assert.equal(done.cardsRecovered, 2);
  assert.equal(done.karasRecovered, 1090);
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [primary]
      )
    ).rows[0].karas_balance,
    910
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [buyer]
      )
    ).rows[0].karas_balance,
    1000
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.user_cards where id=any($1)",
        [[ownedA, ownedB]]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        resoldThird
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
  assert.equal(
    (
      await db.query("select status from public.trade_offers where id=$1", [
        pending
      ])
    ).rows[0].status,
    "cancelled"
  );
  assert.equal(
    (await db.query("select status from public.auctions where id=$1", [active]))
      .rows[0].status,
    "expired"
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anticheat_deleted_account_claims"
      )
    ).rows[0].n,
    4
  );
  assert.equal((await preview()).eligible, false);
  assert.equal(
    (await list()).accounts.every(x => x.availableTransfers === 0),
    true
  );
  assert.equal(
    (
      await asUser(
        admin,
        "select public.admin_preview_sanction($1,'deleted',null,$2)value",
        [primary, [trade]]
      )
    ).rows[0].value.eligible,
    false
  );
  await assert.rejects(
    db.query(
      "delete from public.anticheat_deleted_account_sanctions where id=$1",
      [done.receiptId]
    ),
    /IMMUTABLE/
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from auth.users where id=any($1)",
        [[a, b]]
      )
    ).rows[0].n,
    0
  );
  const receipt = (
    await db.query(
      "select history from public.anticheat_deleted_account_sanctions where id=$1",
      [done.receiptId]
    )
  ).rows[0].history;
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /@example.invalid|FormerAlpha|FormerBeta/
  );
  // Hiding is immediate at expiry even before scheduled physical anonymization.
  await db.query(
    "update public.anticheat_deleted_accounts set identity_expires_at=now()-interval '1 second'"
  );
  assert.equal(
    (await list("", false)).accounts.every(
      x => x.pseudo === null && x.email === null
    ),
    true
  );
  assert.equal((await list("FormerAlpha", false)).total, 0);
  assert.equal(
    (await db.query("select public.purge_anticheat_deleted_identities()n"))
      .rows[0].n,
    2
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anticheat_deleted_accounts where pseudo is not null or email is not null"
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anticheat_deleted_account_transfers"
      )
    ).rows[0].n,
    3
  );
  assert.ok([trade, buy, sellSource, sellThird].every(Boolean));
});

test("an actual Auth deletion role can capture the identity without direct access to private archive tables", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column email text");
  const id = "ac650000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,email)values($1,$2,$3)",
    [
      id,
      JSON.stringify({ pseudo: "DirectAuthDeletion" }),
      "direct@example.invalid"
    ]
  );
  await db.exec(
    "create role test_auth_deleter;grant usage on schema auth to test_auth_deleter;grant select,delete on auth.users to test_auth_deleter;set role test_auth_deleter"
  );
  await db.query("delete from auth.users where id=$1", [id]);
  await assert.rejects(
    db.query("select*from public.anticheat_deleted_accounts"),
    { code: "42501" }
  );
  await db.exec("reset role");
  const row = (
    await db.query(
      "select pseudo,email,extract(epoch from(identity_expires_at-deleted_at))::int seconds from public.anticheat_deleted_accounts where user_id=$1",
      [id]
    )
  ).rows[0];
  assert.equal(row.pseudo, "DirectAuthDeletion");
  assert.equal(row.email, "direct@example.invalid");
  assert.equal(row.seconds, 90 * 86400);
});

test("pre-existing deleted auction parties are recovered only from exact immutable event IDs, without guessing their erased identity", async t => {
  const filenames = fs
    .readdirSync("supabase/migrations")
    .filter(f => f.endsWith(".sql"))
    .sort();
  const pending = filenames.filter(
    f => f.startsWith("20261102232000_") || f.startsWith("20261102232100_")
  );
  const { db } = await replayMigrations({
    migrations: filenames.filter(f => !pending.includes(f))
  });
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column email text,add column banned_until timestamptz"
  );
  const [admin, primary, source] = [1, 2, 3].map(
    i => `ac660000-0000-4000-8000-${String(i).padStart(12, "0")}`
  );
  for (const [id, pseudo] of [
    [admin, "LegacyAdmin"],
    [primary, "LegacyPrimary"],
    [source, "ErasedLegacyIdentity"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email)values($1,$2,$3)",
      [id, JSON.stringify({ pseudo }), `${pseudo}@example.invalid`]
    );
  await db.query("insert into public.admin_users(user_id)values($1)", [admin]);
  const card = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url)values('manual','old-auction-source','SATORU GOJO','ANIME/MANGA','JUJUTSU KAISEN','SSR','https://example.invalid/gojo.png')returning id"
    )
  ).rows[0].id;
  const copy = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity)values($1,$2,'SSR')returning id",
      [primary, card]
    )
  ).rows[0].id;
  const sale = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at,status)values($1,$2,$3,10,10,15,now(),'active')returning id",
      [copy, source, primary]
    )
  ).rows[0].id;
  await db.query("update public.auctions set status='sold'where id=$1", [sale]);
  await db.exec("set role service_role");
  await db.query("select public.begin_account_deletion($1)", [source]);
  await db.query("select public.prepare_account_deletion($1)", [source]);
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1", [source]);
  for (const file of pending)
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin
  ]);
  await db.exec("set role authenticated");
  const list = (
    await db.query(
      "select public.admin_list_deleted_accounts('',$1,true,30,0)value",
      [primary]
    )
  ).rows[0].value;
  assert.equal(list.total, 1);
  assert.equal(list.accounts[0].pseudo, null);
  assert.equal(list.accounts[0].email, null);
  assert.equal(list.accounts[0].transfers, 1);
  const preview = (
    await db.query(
      "select public.admin_preview_deleted_account_sanction($1,$2)value",
      [primary, [source]]
    )
  ).rows[0].value;
  assert.equal(preview.eligible, true);
  assert.equal(preview.recovery.cards, 1);
  assert.equal(preview.recovery.karas, 0);
  assert.equal(preview.history.transfers[0].asset_id, sale);
  assert.equal(
    preview.history.transfers[0].card_labels[copy].name,
    "SATORU GOJO"
  );
  await db.exec("reset role");
});
