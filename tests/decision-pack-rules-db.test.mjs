import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = "30000000-0000-4000-8000-000000000001";
async function rpc(db, sql, params = []) {
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      player
    ]);
    return (await db.query(sql, params)).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}
async function fixture(t) {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"DecisionRules"}\')',
    [player]
  );
  for (const rarity of ["SR", "SSR", "LR"]) {
    await db.query(
      `insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
      values ($1,$1,'DecisionRules','DecisionRules',$2,'https://example.test/card.png','test')`,
      [`rules-${rarity}`, rarity]
    );
  }
  return db;
}

test("Decision destruction uses the same server reward as collection and keep", async t => {
  const db = await fixture(t);
  // A future reward rebalance must affect every path, without client constants.
  await db.exec(`create or replace function public.card_destruction_value(p_rarity public.card_rarity)
    returns integer language sql immutable set search_path='' as $$select 17$$;`);
  const copy = (
    await db.query(
      `insert into public.user_cards(user_id,card_id,rarity)
    select $1,id,rarete_base from public.cards where source_id='rules-SR' returning id`,
      [player]
    )
  ).rows[0].id;
  const initial = await rpc(db, "select public.get_game_info() as result");
  await rpc(db, "select public.discard_collection_card($1) as result", [copy]);
  assert.equal(
    (await rpc(db, "select public.get_game_info() as result")).karasBalance,
    initial.karasBalance + 17
  );
  const choices = await rpc(db, "select public.open_decision_pack() as result");
  await rpc(db, "select public.discard_decision_pack_card($1) as result", [
    choices[0].instanceId
  ]);
  assert.equal(
    (await rpc(db, "select public.get_game_info() as result")).karasBalance,
    initial.karasBalance + 34
  );
  const kept = await rpc(
    db,
    "select public.keep_decision_pack_card($1) as result",
    [choices[1].instanceId]
  );
  assert.equal(kept.karasReward, 51);
  assert.equal(
    (await rpc(db, "select public.get_game_info() as result")).karasBalance,
    initial.karasBalance + 85
  );
});

test("Decision draw and game info share the server drop rates", async t => {
  const db = await fixture(t);
  const expected = [
    { rarity: "SR", percent: 96.5 },
    { rarity: "SSR", percent: 3 },
    { rarity: "LR", percent: 0.5 }
  ];
  assert.deepEqual(
    (await rpc(db, "select public.get_game_info() as result"))
      .decisionDropRates,
    expected
  );
  for (const role of ["public", "anon", "authenticated"]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.decision_pack_drop_rates()','EXECUTE') as allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
  }
  const changed = [
    { rarity: "SR", percent: 0 },
    { rarity: "SSR", percent: 0 },
    { rarity: "LR", percent: 100 }
  ];
  await db.exec(`create or replace function public.decision_pack_drop_rates()
    returns jsonb language sql immutable set search_path='' as $$select '${JSON.stringify(changed)}'::jsonb$$;`);
  assert.deepEqual(
    (await rpc(db, "select public.get_game_info() as result"))
      .decisionDropRates,
    changed
  );
  const choices = await rpc(db, "select public.open_decision_pack() as result");
  assert.equal(choices.length, 5);
  assert.ok(
    choices.every(choice => choice.rarity === "LR"),
    "Draw follows the same changed rates displayed by game info"
  );
});
