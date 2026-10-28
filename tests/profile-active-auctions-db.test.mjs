import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("profile sales are seller-scoped, active, paginated and privacy protected", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const [owner, viewer, other] = [1, 2, 3].map(
    n => `75000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  for (const [i, id] of [owner, viewer, other].entries())
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `SalesProfile${i}` })]
    );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('profile-sale','Test sale','ANIME/MANGA','Test Sale','SR','https://example.test/sale.png','test') returning id"
    )
  ).rows[0].id;
  const copies = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) select $1,$2,'SR' from generate_series(1,56) returning id",
      [owner, card]
    )
  ).rows;
  const ids = [];
  for (let i = 0; i < 56; i++) {
    const sale = (
      await db.query(
        "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at,status,created_at) values ($1,$2,100,100,60,now()+interval '1 hour','active','2026-10-15T10:00:00Z') returning id",
        [copies[i].id, i === 55 ? other : owner]
      )
    ).rows[0].id;
    ids.push(sale);
  }
  await db.query("update public.auctions set status='expired' where id=$1", [
    ids[0]
  ]);
  await db.query(
    "update public.auctions set ends_at=now()-interval '1 second' where id=$1",
    [ids[1]]
  );
  const login = async id => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  };
  const list = async (cursor = null, limit = 20) =>
    (
      await db.query(
        "select public.get_profile_active_auctions($1,$2::jsonb,$3) value",
        [owner, cursor ? JSON.stringify(cursor) : null, limit]
      )
    ).rows[0].value;
  await login(viewer);
  const first = await list();
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  assert.ok(
    first.items.every(
      item =>
        item.sellerId === owner &&
        item.status === "active" &&
        item.card.anime === "Test Sale"
    )
  );
  assert.ok(
    first.items.every(
      item =>
        item.amount === 100 && item.bids === 0 && !item.watched && !item.hasBid
    )
  );
  assert.ok(
    first.items.every(
      item =>
        !("balance" in item) &&
        !("card_instance_id" in item) &&
        !("history" in item)
    )
  );
  const all = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const next = await list(cursor);
    all.push(...next.items);
    cursor = next.nextCursor;
  }
  assert.equal(all.length, 53);
  assert.equal(
    new Set(all.map(item => item.id)).size,
    53,
    "equal timestamps do not duplicate or skip auctions"
  );
  assert.ok(!all.some(item => [ids[0], ids[1], ids[55]].includes(item.id)));
  assert.equal((await list(null, 10000)).items.length, 50);
  await assert.rejects(list(null, 0), /INVALID_PAGE_SIZE/);
  await assert.rejects(list({}), /INVALID_CURSOR/);
  await db.exec("reset role");
  await db.query(
    "insert into public.auction_watchers(auction_id,user_id) values ($1,$2)",
    [first.items[0].id, viewer]
  );
  await login(viewer);
  assert.equal((await list()).items[0].watched, true);
  await db.exec("reset role");
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [owner]
  );
  await login(viewer);
  assert.deepEqual(await list(), { items: [], nextCursor: null });
  await login(owner);
  assert.equal((await list()).items.length, 20, "private owner sees own sales");
  await db.exec("reset role");
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted')",
    [owner, viewer]
  );
  await login(viewer);
  assert.equal(
    (await list()).items.length,
    20,
    "accepted friend sees private sales"
  );
  for (const [blocker, blocked] of [
    [owner, viewer],
    [viewer, owner]
  ]) {
    await db.exec("reset role");
    await db.query(
      "insert into public.user_blocks(blocker_id,blocked_id) values ($1,$2)",
      [blocker, blocked]
    );
    await login(viewer);
    assert.deepEqual(
      await list(),
      { items: [], nextCursor: null },
      "bilateral blocks hide the seller feed"
    );
    await db.exec("reset role");
    await db.exec("delete from public.user_blocks");
  }
  await db.query(
    "insert into public.account_deletion_log(user_id) values ($1)",
    [owner]
  );
  await login(viewer);
  assert.deepEqual(
    await list(),
    { items: [], nextCursor: null },
    "deleting owner is fenced"
  );
  await db.exec("reset role");
  await db.exec("delete from public.account_deletion_log");
  await db.query(
    "insert into public.account_deletion_log(user_id) values ($1)",
    [viewer]
  );
  await login(viewer);
  assert.deepEqual(
    await list(),
    { items: [], nextCursor: null },
    "deleting viewer is fenced"
  );
  await db.exec("set role anon");
  await assert.rejects(list(), /permission denied/);
});
