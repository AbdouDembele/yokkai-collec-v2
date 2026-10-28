import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const request = "30000000-0000-4000-8000-000000000001";
const next = "30000000-0000-4000-8000-000000000002";

test("export refuses actual row and UTF-8 byte limits without returning a partial file", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"LimitPlayer"}\')',
    [a]
  );
  await db.query("select public.reserve_data_export($1,$2)", [a, request]);
  await db.query(
    "insert into public.folders(user_id,nom) select $1,'folder-'||n from generate_series(1,100001) n",
    [a]
  );
  await assert.rejects(
    db.query("select public.build_data_export($1,$2)", [a, request]),
    /EXPORT_TOO_LARGE/
  );
  await db.query("delete from public.folders where user_id=$1", [a]);
  const auction = (
    await db.query(
      "insert into public.auctions(seller_id,starting_price,current_price,duration_minutes,ends_at) values ($1,10,10,60,now()+interval '1 hour') returning id",
      [a]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.auction_chat_messages(auction_id,user_id,message,gif_url) select $1,$2,repeat('x',500),'https://i.giphy.com/'||repeat('a',950) from generate_series(1,17000)",
    [auction, a]
  );
  await assert.rejects(
    db.query("select public.build_data_export($1,$2)", [a, request]),
    /EXPORT_TOO_LARGE/
  );
  await db.query("select public.finish_data_export($1,$2,false)", [a, request]);
  await db.query("select public.reserve_data_export($1,$2)", [a, next]);
});

test("export isolates two players, classifies profile preferences, and only consumes successful sends", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  // Platform fields supplied by Auth/Storage, absent from the minimal test bootstrap.
  await db.exec(
    "alter table auth.users add column email text, add column encrypted_password text, add column created_at timestamptz default now(); alter table storage.objects add column metadata jsonb, add column created_at timestamptz, add column updated_at timestamptz"
  );
  await db.exec(
    "create table auth.identities(user_id uuid,provider text,created_at timestamptz,updated_at timestamptz)"
  );
  await db.query(
    `insert into auth.users(id,raw_user_meta_data,email,encrypted_password) values
    ($1,'{"pseudo":"PlayerA"}','a@example.test','HASH_MUST_NOT_EXPORT'),
    ($2,'{"pseudo":"PlayerB"}','B_EMAIL_MUST_NOT_EXPORT','B_HASH_MUST_NOT_EXPORT')`,
    [a, b]
  );
  await db.query(
    "update public.user_profiles set is_public=false,bio='ONLY_A_BIO',locale='fr' where user_id=$1",
    [a]
  );
  await db.query(
    "update public.user_profiles set bio='B_BIO_MUST_NOT_EXPORT',locale='en' where user_id=$1",
    [b]
  );
  await db.query(
    "insert into public.folders(user_id,nom) values ($1,'ONLY_A_FOLDER'),($2,'B_FOLDER_MUST_NOT_EXPORT')",
    [a, b]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted')",
    [a, b]
  );
  const ownCard = "20000000-0000-4000-8000-000000000001";
  const otherCard = "20000000-0000-4000-8000-000000000002";
  const ownInstance = "40000000-0000-4000-8000-000000000001";
  const otherInstance = "40000000-0000-4000-8000-000000000002";
  const ownPack = "50000000-0000-4000-8000-000000000001";
  const otherPack = "50000000-0000-4000-8000-000000000002";
  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values ($1,'own','OWN_CARD','ANIME/MANGA','OWN_LICENSE','SR','https://example.test/own.png','test'),($2,'other','B_CARD_MUST_NOT_EXPORT','ANIME/MANGA','OTHER_LICENSE','SR','https://example.test/other.png','test')",
    [ownCard, otherCard]
  );
  await db.query(
    "insert into public.user_cards(id,user_id,card_id,rarity,custom_image_url,is_locked) values ($1,$2,$3,'SR','https://i.imgur.com/own.png?token=MUST_NOT_EXPORT',true),($4,$5,$6,'SR',null,false)",
    [ownInstance, a, ownCard, otherInstance, b, otherCard]
  );
  await db.query(
    "insert into public.decision_packs(id,user_id) values ($1,$2),($3,$4)",
    [ownPack, a, otherPack, b]
  );
  await db.query(
    "insert into public.decision_pack_choices(pack_id,card_id,rarity,position) values ($1,$2,'SR',1),($3,$4,'SR',1)",
    [ownPack, ownCard, otherPack, otherCard]
  );
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values ($1,'OWN_LICENSE'),($2,'B_LICENSE_MUST_NOT_EXPORT')",
    [a, b]
  );
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_karas,requested_karas) values ($1,$2,7,1234567)",
    [a, b]
  );
  await db.query(
    "insert into public.user_reports(reporter_id,reported_id,reason,context_type,details,snapshot) values ($2,$1,'spam','profile','RECEIVED_REPORT_MUST_NOT_EXPORT','{\"secret\":\"SNAPSHOT_MUST_NOT_EXPORT\"}')",
    [a, b]
  );
  await db.exec("delete from public.notifications");
  await db.query(
    "insert into public.notifications(user_id,type,actor_user_id,reference_id) values ($2,'friend_request',$1,$1)",
    [a, b]
  );
  await db.query(
    'insert into storage.objects(bucket_id,name,owner_id,metadata) values (\'avatars\',$1,$2,\'{"size":42,"mimetype":"image/png","secret":"STORAGE_SECRET_MUST_NOT_EXPORT"}\')',
    [`${a}/avatar.png`, a]
  );
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select public.reserve_data_export($1,$2)", [a, request]),
      /permission denied/
    );
    await assert.rejects(
      db.query("select public.build_data_export($1,$2)", [b, request]),
      /permission denied/
    );
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  await assert.rejects(
    db.query("select public.reserve_data_export(null,$1)", [request]),
    /AUTH_REQUIRED/
  );
  await db.query("select public.reserve_data_export($1,$2)", [a, request]);
  await assert.rejects(
    db.query("select public.reserve_data_export($1,$2)", [a, next]),
    /EXPORT_IN_PROGRESS/
  );
  await assert.rejects(
    db.query("select public.build_data_export($1,$2)", [b, request]),
    /EXPORT_RESERVATION_REQUIRED/
  );
  const read = async (player = a, token = request) =>
    (
      await db.query("select public.build_data_export($1,$2) value", [
        player,
        token
      ])
    ).rows[0].value;
  const data = await read();
  assert.equal(data.schema_version, 1);
  assert.equal(data.account.email, "a@example.test");
  assert.equal(data.profile.bio, "ONLY_A_BIO");
  assert.equal(data.profile.is_public, false);
  assert.equal(data.profile.locale, "fr");
  assert.equal(data.folders[0].nom, "ONLY_A_FOLDER");
  assert.equal(data.collection.length, 1);
  assert.equal(data.collection[0].id, ownInstance);
  assert.equal(data.collection[0].is_locked, true);
  assert.equal(
    data.collection[0].custom_image_url,
    "https://i.imgur.com/own.png"
  );
  assert.equal(data.decision_pack_choices.length, 1);
  assert.equal(data.decision_pack_choices[0].pack_id, ownPack);
  assert.equal(data.catalogue_cards.length, 1);
  assert.equal(data.catalogue_cards[0].name, "OWN_CARD");
  assert.equal(data.album_favorites[0].license, "OWN_LICENSE");
  assert.equal(data.trades[0].own_karas, 7);
  assert.deepEqual(Object.keys(data.trades[0].counterparty).sort(), [
    "date",
    "pseudo"
  ]);
  assert.equal(data.trades[0].counterparty.pseudo, "PlayerB");
  assert.deepEqual(data.messages, []);
  assert.deepEqual(data.notifications, []);
  assert.deepEqual(data.submitted_reports, []);
  assert.deepEqual(
    data.avatar_files.map(({ type, size }) => ({ type, size })),
    [{ type: "image/png", size: 42 }]
  );
  const text = JSON.stringify(data);
  for (const forbidden of [
    b,
    otherCard,
    otherInstance,
    otherPack,
    "MUST_NOT_EXPORT",
    "1234567",
    "encrypted_password",
    "identity_data",
    "actor_user_id",
    "snapshot"
  ])
    assert.ok(!text.includes(forbidden), forbidden);
  await db.exec("reset role");
  const columns = (
    await db.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='user_profiles'"
    )
  ).rows
    .map(r => r.column_name)
    .filter(c => c !== "user_id")
    .sort();
  assert.deepEqual(Object.keys(data.profile).sort(), columns);
  await db.exec(
    "alter table public.user_profiles add column unclassified_preference text default 'UNKNOWN_MUST_NOT_EXPORT'; set role service_role"
  );
  assert.ok(!JSON.stringify(await read()).includes("UNKNOWN_MUST_NOT_EXPORT"));
  // Generation/cancel failure releases the slot; wrong request cannot release it.
  await db.query("select public.finish_data_export($1,$2,false)", [a, next]);
  await assert.rejects(
    db.query("select public.reserve_data_export($1,$2)", [a, next]),
    /EXPORT_IN_PROGRESS/
  );
  await db.query("select public.finish_data_export($1,$2,false)", [a, request]);
  await db.query("select public.reserve_data_export($1,$2)", [a, next]);
  await db.query("select public.finish_data_export($1,$2,true)", [a, next]);
  await assert.rejects(
    db.query("select public.reserve_data_export($1,$2)", [a, request]),
    /EXPORT_RATE_LIMITED/
  );
  await db.exec("reset role");
  await db.query(
    "update public.data_export_state set sent_at=clock_timestamp()-interval '24 hours' where user_id=$1",
    [a]
  );
  await db.exec("set role service_role");
  await db.query("select public.reserve_data_export($1,$2)", [b, request]);
  const other = await read(b, request);
  assert.equal(other.account.email, "B_EMAIL_MUST_NOT_EXPORT");
  assert.equal(other.profile.locale, "en");
  assert.ok(!JSON.stringify(other).includes("ONLY_A"));
  await db.query("select public.reserve_data_export($1,$2)", [a, request]);
  await db.query("select public.mark_data_export_sending($1,$2)", [a, request]);
  await assert.rejects(
    db.query("select public.reserve_data_export($1,$2)", [a, next]),
    /EXPORT_IN_PROGRESS/
  );
  await db.exec("reset role");
  await db.query(
    "insert into public.account_deletion_log(user_id) values ($1)",
    [a]
  );
  await db.exec("set role service_role");
  await assert.rejects(read(), /ACCOUNT_DELETED/);
});
