import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("Home interest and friend activity are ranked before pagination", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const viewer = "18000000-0000-4000-8000-000000000001";
  const seller = "18000000-0000-4000-8000-000000000002";
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values
    ($1,'{"pseudo":"ActivityViewer"}'),($2,'{"pseudo":"ActivitySeller"}')`,
    [viewer, seller]
  );
  await db.exec(`insert into auth.users(id,raw_user_meta_data)
    select md5('activity-friend-'||i)::uuid,jsonb_build_object('pseudo',case when i>=149 then 'Zzz' else 'Aaa' end||lpad(i::text,3,'0'))
    from generate_series(1,150) i;
    insert into public.friendships(user_id,friend_id,status)
    select '${viewer}'::uuid,md5('activity-friend-'||i)::uuid,'accepted' from generate_series(1,150) i;
    update public.user_profiles p set last_seen_at=statement_timestamp()-make_interval(mins=>i),presence_active=false
    from generate_series(1,150) i where p.user_id=md5('activity-friend-'||i)::uuid;
    update public.user_profiles set last_seen_at=statement_timestamp()-interval '1 minute',presence_active=true where pseudo='Zzz149';
    update public.user_profiles set last_seen_at=statement_timestamp()-interval '2 minutes',presence_active=true where pseudo='Zzz150';
    update public.user_profiles set last_seen_at=null,presence_active=true where pseudo='Aaa148';
    update public.user_profiles set last_seen_at=statement_timestamp()-interval '1 day',presence_active=true where pseudo='Aaa147';
    insert into public.friendships(user_id,friend_id,status) values ('${seller}','${viewer}','pending');`);
  async function authenticate() {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      viewer
    ]);
  }
  await authenticate();
  const all = (await db.query("select public.get_friendships() value")).rows[0]
    .value;
  assert.deepEqual(
    all.friends.slice(0, 4).map(p => p.pseudo),
    ["Zzz149", "Zzz150", "Aaa001", "Aaa002"]
  );
  assert.deepEqual(
    all.friends.slice(-2).map(p => p.pseudo),
    ["Aaa147", "Aaa148"]
  );
  assert(all.friends.slice(0, 2).every(p => p.isOnline));
  assert(all.friends.slice(2).every(p => !p.isOnline));
  assert.equal(all.incoming.length, 1);
  assert.equal("lastSeenAt" in all.incoming[0], false);
  for (const size of [1, 37, 100]) {
    const buckets = { friends: [], incoming: [], outgoing: [] };
    let cursor = null,
      pages = 0;
    do {
      const page = (
        await db.query("select public.get_friendships_page($1,$2) value", [
          cursor,
          size
        ])
      ).rows[0].value;
      for (const item of page.items) buckets[item.bucket].push(item.friend);
      cursor = page.nextCursor;
      assert(++pages < 155);
      if (cursor) assert.equal(typeof cursor.seen, "string");
    } while (cursor);
    assert.deepEqual(buckets, all);
    assert.equal(new Set(buckets.friends.map(p => p.id)).size, 150);
  }
  const restarted = (
    await db.query("select public.get_friendships_page($1,1) value", [
      { kind: 0, name: "zzz", sortAt: "-infinity", id: seller }
    ])
  ).rows[0].value;
  assert.equal(restarted.items[0].friend.pseudo, "Zzz149");
  await db.exec("reset role");

  const card = (
    await db.query(`insert into public.cards(source_id,nom,franchise,categorie,rarete_base,image_url,source,favoris_count)
    values ('home-interest','Home interest','Home test','ANIME/MANGA','SR','https://example.test/home.png','test',999999) returning id`)
  ).rows[0].id;
  const auctions = [];
  for (let i = 0; i < 8; i++) {
    const copy = (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SR') returning id",
        [seller, card]
      )
    ).rows[0].id;
    auctions.push(
      (
        await db.query(
          `insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at)
      values ($1,$2,10,10,60,statement_timestamp()+make_interval(mins=>$3)) returning id`,
          [copy, seller, i + 1]
        )
      ).rows[0].id
    );
  }
  // Earliest ending is personally pinned; the longest running attracts 3 people.
  await db.query(
    "insert into public.auction_watchers(auction_id,user_id) values ($1,$2)",
    [auctions[0], viewer]
  );
  for (let i = 1; i <= 3; i++)
    await db.query(
      "insert into public.auction_watchers(auction_id,user_id) values ($1,md5('activity-friend-'||$2)::uuid)",
      [auctions[7], String(i)]
    );
  for (let i = 0; i < 12; i++)
    await db.query(
      "insert into public.bids(auction_id,bidder_id,amount) values ($1,md5('activity-friend-1')::uuid,$2)",
      [auctions[7], 10 + i * 10]
    );
  await db.query(
    "insert into public.auction_watchers(auction_id,user_id) values ($1,$2)",
    [auctions[7], seller]
  );
  await authenticate();
  async function browse(sort, limit = 6) {
    return (
      await db.query(
        "select public.browse_auctions_page($1,'','','',$2,'active') value",
        [limit, sort]
      )
    ).rows[0].value;
  }
  const home = await browse("interest");
  assert.equal(home.items.length, 6);
  assert.equal(home.items[0].id, auctions[7]);
  assert.equal(
    home.items[0].popularity,
    3,
    "repeat bids, seller and overlapping follows do not inflate interest"
  );
  assert.equal(home.items[1].id, auctions[0]);
  assert.equal(
    (await browse("interest", 1)).items[0].id,
    auctions[7],
    "interest wins before LIMIT"
  );
  assert.equal(
    (await browse("popular", 1)).items[0].id,
    auctions[0],
    "Market keeps personal watch-list priority"
  );
  assert.equal(home.hasMore, true);
  await db.exec("reset role;set role anon");
  await assert.rejects(
    db.query("select public.get_friendships_page(null,100)"),
    { code: "42501" }
  );
  await assert.rejects(
    db.query(
      "select public.browse_auctions_page(6,'','','','interest','active')"
    ),
    { code: "42501" }
  );
});
