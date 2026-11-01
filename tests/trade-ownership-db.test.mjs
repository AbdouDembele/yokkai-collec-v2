import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("trade context counts all of the viewer's variants without exposing locked partner cards", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const owner = "d9100000-0000-4000-8000-000000000001";
  const friend = "d9100000-0000-4000-8000-000000000002";
  const stranger = "d9100000-0000-4000-8000-000000000003";
  for (const [id, pseudo] of [
    [owner, "OwnedViewer"],
    [friend, "OwnedFriend"],
    [stranger, "OwnedStranger"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.query(
    "insert into public.friendships(user_id,friend_id,status)values($1,$2,'accepted')",
    [owner, friend]
  );
  const card = (
    await db.query(
      "insert into public.cards(source,source_id,nom,categorie,rarete_base,image_url)values('test','trade-owned','Owned Fixture','ANIME/MANGA','SSR','https://example.test/owned.png')returning id"
    )
  ).rows[0].id;
  const insert = async (user, locked = false, shiny = false, evolved = false) =>
    (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity,is_locked,is_shiny,is_evolved)values($1,$2,'SSR',$3,$4,$5)returning id",
        [user, card, locked, shiny, evolved]
      )
    ).rows[0].id;
  const normal = await insert(owner);
  await insert(owner, true);
  const listed = await insert(owner);
  await insert(owner, true, true);
  await insert(owner, true, true, true);
  const partnerNormal = await insert(friend);
  await insert(friend, true);
  await db.query(
    "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at)values($1,$2,10,10,60,now()+interval '1 hour')",
    [listed, owner]
  );
  const call = async (viewer, partner) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      viewer
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query("select public.get_trade_context($1) value", [partner])
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const context = await call(owner, friend);
  assert.deepEqual(
    context.ownCards.map(c => c.instanceId),
    [normal]
  );
  assert.deepEqual(
    context.friendCards.map(c => c.instanceId),
    [partnerNormal]
  );
  const variants = context.ownedVariants.sort(
    (a, b) =>
      Number(a.shiny) - Number(b.shiny) ||
      Number(a.isEvolved) - Number(b.isEvolved)
  );
  assert.deepEqual(variants, [
    { id: card, rarity: "SSR", shiny: false, isEvolved: false, count: 3 },
    { id: card, rarity: "SSR", shiny: true, isEvolved: false, count: 1 },
    { id: card, rarity: "SSR", shiny: true, isEvolved: true, count: 1 }
  ]);
  const reverse = await call(friend, owner);
  assert.deepEqual(reverse.ownedVariants, [
    { id: card, rarity: "SSR", shiny: false, isEvolved: false, count: 2 }
  ]);
  await assert.rejects(call(stranger, friend), /FRIENDS_ONLY/);
  await assert.rejects(call("", friend), /AUTH_REQUIRED/);
  const privileges = (
    await db.query(
      "select has_function_privilege('anon','public.get_trade_context(uuid)','execute') anon,has_function_privilege('authenticated','public.get_trade_context(uuid)','execute') player"
    )
  ).rows[0];
  assert.deepEqual(privileges, { anon: false, player: true });
});
