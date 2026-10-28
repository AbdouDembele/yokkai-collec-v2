import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const migration = "20261012000002_live_card_franchises.sql";
const names = [
  "decision_pack_cards",
  "get_auction",
  "get_card_discovery",
  "get_profile",
  "keep_decision_pack_card",
  "list_auctions",
  "list_auctions_page",
  "list_wishlist",
  "open_regular_pack",
  "profile_card_json",
  "trade_card_json"
];
test("live franchise migration changes only optional freshness fields, keeps snapshots and old signatures", async t => {
  const files = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter(n => n.endsWith(".sql") && n < migration)
    .sort();
  const { db } = await replayMigrations({ migrations: files });
  t.after(() => db.close());
  const defs = async () =>
    (
      await db.query(
        "select proname,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[]) order by proname",
        [names]
      )
    ).rows;
  const before = await defs();
  assert.equal(before.length, names.length);
  const id = "10000000-0000-4000-8000-000000000001",
    friend = "10000000-0000-4000-8000-000000000002",
    card = "20000000-0000-4000-8000-000000000001";
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values ($1,'{"pseudo":"Player"}'),($2,'{"pseudo":"Friend"}')`,
    [id, friend]
  );
  await db.query(
    `insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values ($1,'live-franchise','CARD','ANIME/MANGA','OLD','C','https://example.test/card.jpg','manual')`,
    [card]
  );
  const owned = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'C') returning id",
      [id, card]
    )
  ).rows[0].id;
  await db.query(
    "update public.user_profiles set banner_card_id=$2,featured_card_ids=array[$3::uuid] where user_id=$1",
    [id, card, owned]
  );
  await db.query(
    "insert into public.wishlists(user_id,card_id) values ($1,$2)",
    [id, card]
  );
  const auction = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,current_price,starting_price,duration_minutes,ends_at) values ($1,$2,10,10,60,now()+interval '1 hour') returning id",
      [owned, id]
    )
  ).rows[0].id;
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  const old = (await db.query("select public.get_auction($1) v", [auction]))
    .rows[0].v;
  assert.equal(old.card.liveFranchise, undefined);
  await db.exec("reset role");
  await db.exec(
    readFileSync(
      new URL("../supabase/migrations/" + migration, import.meta.url),
      "utf8"
    )
  );
  const after = await defs();
  assert.deepEqual(
    after.map(r => ({
      ...r,
      def: r.def.replaceAll("'liveFranchise',true,", "")
    })),
    before
  );
  await db.query("update public.cards set franchise='UPDATED' where id=$1", [
    card
  ]);
  await db.exec("set role authenticated");
  const profile = (await db.query("select public.get_profile() v")).rows[0].v;
  for (const c of [profile.bannerCard, ...profile.featuredCards]) {
    assert.equal(c.anime, "UPDATED");
    assert.equal(c.liveFranchise, true);
  }
  const wishlist = (await db.query("select public.list_wishlist() v")).rows[0]
    .v;
  assert.equal(wishlist[0].anime, "UPDATED");
  assert.equal(wishlist[0].liveFranchise, true);
  for (const rpc of ["list_auctions", "list_auctions_page"]) {
    const value = (await db.query(`select public.${rpc}() v`)).rows[0].v;
    const items = Array.isArray(value) ? value : value.items;
    assert.equal(items[0].card.anime, "UPDATED");
    assert.equal(items[0].card.liveFranchise, true);
  }
  const updated = (await db.query("select public.get_auction($1) v", [auction]))
    .rows[0].v;
  assert.equal(updated.card.liveFranchise, true);
  await db.exec("reset role");
  await db.query(
    "update public.auctions set card_instance_id=null,card_snapshot=$2::jsonb where id=$1",
    [auction, JSON.stringify(old.card)]
  );
  await db.exec("set role authenticated");
  const snapshot = (
    await db.query("select public.get_auction($1) v", [auction])
  ).rows[0].v;
  assert.equal(snapshot.card.liveFranchise, undefined);
  assert.equal(snapshot.card.anime, "OLD");
});
