import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const id = n => `99200000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("leaderboard SR/SSR/LR totals count every copy, include special cards once and expose only the visible page plus self", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (let n = 1; n <= 4; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id(n), JSON.stringify({ pseudo: `CountRank${n}` })]
    );
  const cards = {};
  for (const rarity of ["C", "SR", "SSR", "LR"])
    cards[rarity] = (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA',$2,'https://example.test/card.png','test') returning id",
        ["count-" + rarity, rarity]
      )
    ).rows[0].id;
  const add = async (owner, rarity, copies, shiny = false, evolved = false) =>
    db.query(
      "insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved) select $1,$2,$3,$4,$5 from generate_series(1,$6::integer)",
      [id(owner), cards[rarity], rarity, shiny, evolved, copies]
    );
  await add(1, "SR", 12);
  await add(1, "SSR", 7);
  await add(1, "SSR", 2, true, true);
  await add(1, "SSR", 3, true);
  await add(1, "LR", 9);
  await add(1, "LR", 2, true);
  await add(1, "LR", 5, false, true);
  await add(1, "C", 3);
  for (const n of [2, 3, 4]) await add(n, "LR", 1);
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(3)]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($2,$1)",
    [id(1), id(4)]
  );
  const read = async (offset = 0, limit = 100, query = "", viewer = 1) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(viewer)
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          "select public.get_collection_leaderboard($1,$2,$3,false) value",
          [offset, limit, query]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const expected = { sr: 12, ssr: 12, lr: 16, infinity: 10, shiny: 2 };
  const result = await read();
  assert.deepEqual(result.cardCounts[id(1)], expected);
  assert.deepEqual(result.cardCounts[id(2)], {
    sr: 0,
    ssr: 0,
    lr: 1,
    infinity: 0,
    shiny: 0
  });
  assert.equal(result.cardCounts[id(3)], undefined);
  assert.equal(result.cardCounts[id(4)], undefined);
  assert.equal(result.mine.uniqueVariants, 7);
  assert.equal(result.mine.infinityVariants, 2);
  assert.equal(result.mine.shinyVariants, 1);
  assert.equal(
    result.mine.score,
    114187,
    "Copy totals must not alter the capped diversity score"
  );
  const page = await read(1, 1);
  assert.deepEqual(
    page.entries.map(e => e.userId),
    [id(2)]
  );
  assert.deepEqual(Object.keys(page.cardCounts).sort(), [id(1), id(2)]);
  assert.deepEqual(page.cardCounts[id(1)], expected);
  const empty = await read(0, 100, "no match");
  assert.deepEqual(Object.keys(empty.cardCounts), [id(1)]);
  const privateView = await read(0, 100, "", 3);
  assert.equal(privateView.mine.isPublic, false);
  assert.deepEqual(privateView.cardCounts[id(3)], {
    sr: 0,
    ssr: 0,
    lr: 1,
    infinity: 0,
    shiny: 0
  });
  // Ownership changes remove counts immediately from the previous owner.
  await db.query(
    "update public.user_cards set user_id=$2 where id=(select id from public.user_cards where user_id=$1 and card_id=$3 limit 1)",
    [id(1), id(2), cards.SR]
  );
  assert.equal((await read()).cardCounts[id(1)].sr, 11);
  assert.equal((await read()).cardCounts[id(2)].sr, 1);
});
