import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = n =>
  `21000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;

async function rpc(db, user, sql, params = []) {
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    return (await db.query(sql, params)).rows[0]?.result;
  } finally {
    await db.exec("reset role");
  }
}

async function balance(db, user) {
  return (
    await db.query(
      "select karas_balance from public.user_profiles where user_id=$1",
      [user]
    )
  ).rows[0].karas_balance;
}

test("selling every Decision Pack choice is atomic, rewarded once and isolated by owner", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (let n = 0; n < 2; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [player(n), JSON.stringify({ pseudo: `SellAll${n}` })]
    );
  await db.exec("update public.user_profiles set karas_balance=100");
  for (const rarity of ["SR", "SSR", "LR"])
    await db.query(
      `insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
       values ($1,$1,'SellAll','SellAll',$2,'https://example.test/card.png','test')`,
      [`sell-all-${rarity}`, rarity]
    );

  const choices = await rpc(
    db,
    player(0),
    "select public.open_decision_pack() as result"
  );
  assert.equal(choices.length, 5);
  const rarities = ["SR", "SSR", "LR", "SSR", "SR"];
  for (const [index, choice] of choices.entries())
    await db.query(
      `update public.decision_pack_choices choices
       set card_id=cards.id,rarity=cards.rarete_base,is_shiny=false
       from public.cards cards
       where choices.id=$1 and cards.source_id=$2`,
      [choice.instanceId, `sell-all-${rarities[index]}`]
    );

  await assert.rejects(
    rpc(db, player(1), "select public.discard_decision_pack() as result"),
    /DECISION_PACK_NOT_PENDING/
  );
  assert.equal(await balance(db, player(1)), 100);

  const reward = await rpc(
    db,
    player(0),
    "select public.discard_decision_pack() as result"
  );
  assert.equal(reward, 19);
  assert.equal(await balance(db, player(0)), 119);
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from public.user_cards where user_id=$1",
          [player(0)]
        )
      ).rows[0].count
    ),
    0
  );
  assert.deepEqual(
    (
      await db.query(
        `select packs.status,packs.kept_choice_id,packs.claimed_at is not null as claimed,
                count(choices.id) filter(where choices.is_discarded)::int as discarded
         from public.decision_packs packs
         join public.decision_pack_choices choices on choices.pack_id=packs.id
         where packs.user_id=$1
         group by packs.id`,
        [player(0)]
      )
    ).rows[0],
    {
      status: "claimed",
      kept_choice_id: null,
      claimed: true,
      discarded: 5
    }
  );
  assert.equal(
    (
      await db.query(
        "select decision_packs_completed from public.user_achievement_stats where user_id=$1",
        [player(0)]
      )
    ).rows[0].decision_packs_completed,
    1
  );

  await assert.rejects(
    rpc(db, player(0), "select public.discard_decision_pack() as result"),
    /DECISION_PACK_NOT_PENDING/
  );
  assert.equal(await balance(db, player(0)), 119);
  for (const [role, expected] of [
    ["public", false],
    ["anon", false],
    ["authenticated", true]
  ])
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.discard_decision_pack()','EXECUTE') as allowed",
          [role]
        )
      ).rows[0].allowed,
      expected
    );
});
