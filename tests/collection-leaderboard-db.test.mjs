import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const id = n => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function fixture(t) {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (let n = 1; n <= 8; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [
        id(n),
        JSON.stringify({ pseudo: `Collector${n}`, secret: "Never return me" })
      ]
    );
  const cards = {};
  for (const [n, rarity] of ["C", "R", "SR", "SSR", "LR", "LR"].entries()) {
    cards[n] = (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA',$2,'https://example.test/card.png','test') returning id",
        [`leaderboard-${n}`, rarity]
      )
    ).rows[0].id;
  }
  const give = async (owner, card, count = 1, shiny = false, evolved = false) =>
    db.query(
      `insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved)
     select $1,id,rarete_base,$3,$4 from public.cards cross join generate_series(1,$5) where id=$2 returning id`,
      [id(owner), cards[card], shiny, evolved, count]
    );
  const rank = async (owner = 1, offset = 0, limit = 20) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(owner)
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          "select public.get_collection_leaderboard($1,$2) value",
          [offset, limit]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  return { db, give, rank };
}

test("collection scoring values every rarity, separates Infinity from natural Shiny, and caps identical duplicates", async t => {
  const { db, give, rank } = await fixture(t);
  for (let card = 0; card < 5; card++) await give(1, card);
  await give(1, 3, 1, true, true);
  await give(1, 4, 1, false, true);
  await give(1, 4, 1, true, false);
  let data = await rank();
  assert.equal(data.mine.score, 80130);
  assert.equal(data.mine.uniqueVariants, 8);
  assert.equal(data.mine.infinityVariants, 2);
  assert.equal(data.mine.shinyVariants, 1);
  assert.deepEqual(
    data.mine.breakdown.map(r => [r.rarity, r.variant, r.points]),
    [
      ["LR", "shiny", 50000],
      ["LR", "infinity", 18000],
      ["SSR", "infinity", 6000],
      ["LR", "standard", 5000],
      ["SSR", "standard", 1000],
      ["SR", "standard", 100],
      ["R", "standard", 25],
      ["C", "standard", 5]
    ]
  );
  await give(1, 4, 4);
  data = await rank();
  assert.equal(data.mine.score, 84130);
  assert.equal(
    data.mine.breakdown.find(r => r.rarity === "LR" && r.variant === "standard")
      .duplicatePoints,
    4000
  );
  await give(1, 4, 25);
  assert.equal((await rank()).mine.score, data.mine.score);
  // SSR's old shiny-only storage also denotes Infinity, without a second bonus.
  await give(2, 3, 1, true, false);
  await give(2, 3, 1, true, true);
  const legacy = (await rank(2)).mine;
  assert.equal(legacy.score, 7200);
  assert.equal(legacy.uniqueVariants, 1);
  assert.equal(legacy.shinyVariants, 0);
  // Locked copies and metadata never inflate score or change eligibility.
  await db.query(
    "update public.user_cards set is_locked=true where user_id=$1",
    [id(1)]
  );
  assert.equal((await rank()).mine.score, data.mine.score);
});

test("diversity beats duplicate farming, ties share ranks, and transferred or deleted cards move points immediately", async t => {
  const { db, give, rank } = await fixture(t);
  const owned = (await give(1, 4, 5)).rows;
  await give(2, 4);
  await give(2, 5);
  await give(3, 4);
  await give(3, 5);
  let data = await rank();
  assert.deepEqual(
    data.entries.map(r => [r.pseudo, r.score, r.position]),
    [
      ["Collector2", 10000, 1],
      ["Collector3", 10000, 1],
      ["Collector1", 9000, 3]
    ]
  );
  assert.equal(data.mine.position, 3);
  await db.query("update public.user_cards set user_id=$1 where id=$2", [
    id(4),
    owned[0].id
  ]);
  assert.equal((await rank()).mine.score, 8000);
  assert.equal((await rank(4)).mine.score, 5000);
  await db.query("delete from public.user_cards where user_id=$1", [id(1)]);
  data = await rank();
  assert.equal(data.mine.score, 0);
  assert.equal(data.mine.position, null);
  assert.equal(
    data.entries.some(e => e.userId === id(1)),
    false
  );
});

test("private, blocked, banned and deleted accounts stay protected, and API grants and pagination are bounded", async t => {
  const { db, give, rank } = await fixture(t);
  for (let owner = 1; owner <= 6; owner++) await give(owner, 4);
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [id(2)]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2),($3,$1)",
    [id(1), id(3), id(4)]
  );
  // Bootstrap mirrors older Auth versions without this optional column.
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [id(5)]
  );
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [id(6)]
  );
  const data = await rank();
  assert.equal(data.rankedPlayers, 3);
  assert.equal(data.total, 1);
  assert.deepEqual(
    data.entries.map(r => r.userId),
    [id(1)]
  );
  assert.equal(JSON.stringify(data).includes("Never return me"), false);
  assert.equal(JSON.stringify(data).includes("cardId"), false);
  assert.equal(JSON.stringify(data).includes("email"), false);
  const privateResult = await rank(2);
  assert.equal(privateResult.mine.isPublic, false);
  assert.equal(privateResult.mine.score, 5000);
  assert.equal(privateResult.mine.position, null);
  assert.equal(
    privateResult.entries.some(e => e.userId === id(2)),
    false
  );
  const page = await rank(2, 1, 1);
  assert.equal(page.entries.length, 1);
  assert.equal(page.offset, 1);
  assert.equal(page.limit, 1);
  assert.equal((await rank(2, -50, 99999)).limit, 50);
  assert.equal((await rank(2, -50, -1)).offset, 0);
  assert.equal((await rank(2, 99999999)).offset, 1000000);
  await assert.rejects(rank(5), /ACCOUNT_BANNED/);
  await assert.rejects(rank(6), /PROFILE_MISSING/);
  await assert.rejects(
    db.query("select public.get_collection_leaderboard()"),
    /AUTH_REQUIRED/
  );
  for (const role of ["anon", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query("select public.get_collection_leaderboard()"),
      /permission denied/
    );
    await db.exec("reset role");
  }
});

test("evolution consolidates actual holdings and preserves the 5 SSR / 3 LR fusion premium", async t => {
  const { db, give, rank } = await fixture(t);
  const lr = (await give(1, 4, 3)).rows.map(r => r.id);
  const ssr = (await give(2, 3, 5)).rows.map(r => r.id);
  assert.equal((await rank(1)).mine.score, 7000);
  assert.equal((await rank(2)).mine.score, 1800);
  for (const [owner, fn, copies] of [
    [1, "evolve_lr_card", lr],
    [2, "evolve_ssr_card", ssr]
  ]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(owner)
    ]);
    await db.exec("set role authenticated");
    await db.query(`select public.${fn}($1::uuid[])`, [copies]);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
  assert.equal((await rank(1)).mine.score, 18000);
  assert.equal((await rank(2)).mine.score, 6000);
});
