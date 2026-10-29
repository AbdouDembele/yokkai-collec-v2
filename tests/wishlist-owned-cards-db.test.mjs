import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
test("owned cards can be explicitly wishlisted and remain wishlisted after acquisition without changing access controls", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column banned_until timestamptz");
  const alice = "a9310000-0000-4000-8000-000000000001",
    bob = "a9310000-0000-4000-8000-000000000002";
  for (const id of [alice, bob])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2::jsonb)",
      [
        id,
        JSON.stringify({ pseudo: id === alice ? "OwnedWisher" : "OtherWisher" })
      ]
    );
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)values('owned-wish','Owned wish','ANIME/MANGA','Wish','R','https://example.test/card.png','test')returning id"
    )
  ).rows[0].id;
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity)values($1,$2,'R')",
    [alice, card]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  const toggle = async () =>
    (await db.query("select public.toggle_wishlist($1) as value", [card]))
      .rows[0].value;
  assert.equal(await toggle(), true);
  assert.equal(
    (
      await db.query("select public.list_wishlist() as value")
    ).rows[0].value.some(c => c.id === card),
    true
  );
  assert.equal(await toggle(), false);
  assert.equal(await toggle(), true);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob]);
  assert.equal(await toggle(), true);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  assert.equal(await toggle(), false);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob]);
  assert.equal(
    (await db.query("select public.list_wishlist() as value")).rows[0].value
      .length,
    1
  );
  await db.exec("reset role");
  await db.query(
    "update auth.users set banned_until=now()+interval '1 hour' where id=$1",
    [alice]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  await assert.rejects(toggle, /ACCOUNT_BANNED/);
  await db.exec("reset role");
  await db.query("update auth.users set banned_until=null where id=$1", [
    alice
  ]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  assert.equal(await toggle(), true);
  await db.exec("reset role");
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity)values($1,$2,'R')",
    [alice, card]
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) as n from public.wishlists where user_id=$1",
          [alice]
        )
      ).rows[0].n
    ),
    1
  );
  // An ordinary transfer and BOTH RPC-specific cleanup paths must retain intent.
  await db.query(
    "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')",
    [alice, bob]
  );
  const copy = (
    await db.query(
      "select id from public.user_cards where user_id=$1 and card_id=$2 limit 1",
      [alice, card]
    )
  ).rows[0].id;
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  const offer = (
    await db.query(
      "select public.create_trade_offer($1,array[$2]::uuid[]) as id",
      [bob, copy]
    )
  ).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob]);
  assert.equal(
    (
      await db.query("select public.respond_trade_offer($1,'accept') as ok", [
        offer
      ])
    ).rows[0].ok,
    true
  );
  await db.exec("reset role");
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        copy
      ])
    ).rows[0].user_id,
    bob
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) as n from public.wishlists where card_id=$1",
          [card]
        )
      ).rows[0].n
    ),
    2
  );
  await db.query("update public.user_cards set user_id=$1 where id=$2", [
    alice,
    copy
  ]);
  await db.query(
    "insert into public.auctions(seller_id,card_instance_id,starting_price,current_price,buyer_id,duration_minutes,ends_at)values($1,$2,10,20,$3,15,now()-interval '1 minute')",
    [alice, copy, bob]
  );
  await db.query("select public.settle_expired_auctions()");
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        copy
      ])
    ).rows[0].user_id,
    bob
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) as n from public.wishlists where card_id=$1",
          [card]
        )
      ).rows[0].n
    ),
    2
  );
  // Evolution removes card instances, never the underlying wishlist request.
  await db.query("delete from public.user_cards where id=$1", [copy]);
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) as n from public.wishlists where card_id=$1",
          [card]
        )
      ).rows[0].n
    ),
    2
  );
  await db.exec("set role anon");
  await assert.rejects(toggle, /permission denied/);
});
