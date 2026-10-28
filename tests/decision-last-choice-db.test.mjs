import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const player = n =>
  `20000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;
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

test("Decision: keep after 0-4 destructions preserves cards, rewards and achievements", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (let n = 0; n < 6; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [player(n), JSON.stringify({ pseudo: `LastChoice${n}` })]
    );
  await db.exec("update public.user_profiles set karas_balance=100");
  for (const rarity of ["SR", "SSR", "LR"])
    await db.query(
      `insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values ($1,$1,'LastChoice','LastChoice',$2,'https://example.test/card.png','test')`,
      [`last-${rarity}`, rarity]
    );

  // Run the broken path first for an explicit RED proof, then all positive-reward
  // combinations. Player actions use the real RPCs; deterministic choices are fixtures.
  for (const n of [4, 0, 1, 2, 3])
    await t.test(`keep after ${n} discarded choices`, async () => {
      const user = player(n);
      const choices = await rpc(
        db,
        user,
        "select public.open_decision_pack() as result"
      );
      assert.equal(choices.length, 5);
      const rarities = ["SR", "SSR", "SR", "SSR", "LR"];
      const rewards = [3, 4, 3, 4];
      for (const [i, choice] of choices.entries())
        await db.query(
          `update public.decision_pack_choices dc
      set card_id=c.id,rarity=c.rarete_base,is_shiny=$3
      from public.cards c where dc.id=$1 and c.source_id=$2`,
          [choice.instanceId, `last-${rarities[i]}`, i === 4]
        );
      const chosen = choices[4].instanceId;
      await assert.rejects(
        rpc(
          db,
          player(5),
          "select public.keep_decision_pack_card($1) as result",
          [chosen]
        ),
        /DECISION_CHOICE_UNAVAILABLE/
      );
      for (const choice of choices.slice(0, n))
        await rpc(
          db,
          user,
          "select public.discard_decision_pack_card($1) as result",
          [choice.instanceId]
        );
      const before = await balance(db, user);
      assert.equal(
        before,
        100 + rewards.slice(0, n).reduce((a, b) => a + b, 0)
      );
      const kept = await rpc(
        db,
        user,
        "select public.keep_decision_pack_card($1) as result",
        [chosen]
      );
      assert.equal(
        kept.karasReward,
        rewards.slice(n).reduce((a, b) => a + b, 0)
      );
      assert.equal(await balance(db, user), 114); // exactly the same total, regardless of when discarded
      const pack = (
        await db.query(
          `select p.status,p.kept_choice_id,p.claimed_at is not null as claimed,
      count(c.id) filter(where c.is_discarded)::int as discarded
      from public.decision_packs p join public.decision_pack_choices c on c.pack_id=p.id
      where p.user_id=$1 group by p.id`,
          [user]
        )
      ).rows[0];
      assert.deepEqual(pack, {
        status: "claimed",
        kept_choice_id: chosen,
        claimed: true,
        discarded: 4
      });
      assert.deepEqual(
        (
          await db.query(
            `select id,rarity,is_shiny,is_evolved,is_first_owner from public.user_cards where user_id=$1`,
            [user]
          )
        ).rows,
        [
          {
            id: kept.instanceId,
            rarity: "LR",
            is_shiny: true,
            is_evolved: false,
            is_first_owner: true
          }
        ]
      );
      assert.equal(
        (
          await db.query(
            "select decision_packs_completed from public.user_achievement_stats where user_id=$1",
            [user]
          )
        ).rows[0].decision_packs_completed,
        1
      );
      for (const id of [
        "decision-decisive",
        "legende-naissante",
        "eclat-inattendu"
      ]) {
        assert.equal(
          (
            await db.query(
              "select completed_at is not null as completed from public.user_achievements where user_id=$1 and achievement_id=$2",
              [user, id]
            )
          ).rows[0]?.completed,
          true,
          id
        );
        assert.equal(
          Number(
            (
              await db.query(
                "select count(*) from public.notifications where user_id=$1 and achievement_id=$2 and type='achievement_completed'",
                [user, id]
              )
            ).rows[0].count
          ),
          1
        );
      }
      await assert.rejects(
        rpc(db, user, "select public.keep_decision_pack_card($1) as result", [
          chosen
        ]),
        /DECISION_CHOICE_UNAVAILABLE/
      );
      assert.equal(await balance(db, user), 114);
      assert.equal(
        Number(
          (
            await db.query(
              "select count(*) from public.user_cards where user_id=$1",
              [user]
            )
          ).rows[0].count
        ),
        1
      );
      assert.equal(
        (
          await db.query(
            "select decision_packs_completed from public.user_achievement_stats where user_id=$1",
            [user]
          )
        ).rows[0].decision_packs_completed,
        1
      );
    });
});

test("zero credits stay forbidden and Decision RPC access stays authenticated only", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await assert.rejects(
    db.query("select public.credit_karas($1,0)", [player(0)]),
    /INVALID_KARAS_AMOUNT/
  );
  for (const [role, expected] of [
    ["public", false],
    ["anon", false],
    ["authenticated", true]
  ]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.keep_decision_pack_card(uuid)','EXECUTE') as allowed",
          [role]
        )
      ).rows[0].allowed,
      expected
    );
  }
});
