import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const alice = "10000000-0000-4000-8000-000000000071";
const bob = "10000000-0000-4000-8000-000000000072";

async function authenticated(db, userId, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userId
    ]);
    const result = await db.query(sql, params);
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

test("bulk destruction removes hundreds of owned cards and credits one atomic reward", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    `insert into auth.users(id,raw_user_meta_data)
      values ($1,'{"pseudo":"BulkAlice"}'),($2,'{"pseudo":"BulkBob"}')`,
    [alice, bob]
  );
  await db.query(
    "insert into public.user_profiles(user_id,pseudo,karas_balance) values ($1,'BulkAlice',10),($2,'BulkBob',20) on conflict(user_id) do update set karas_balance=excluded.karas_balance",
    [alice, bob]
  );
  const cardId = (
    await db.query(`insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
      values ('bulk-delete','Bulk delete','Anime/Manga','Bulk','C','https://example.test/bulk.png','test') returning id`)
  ).rows[0].id;
  const ids = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) select $1,$2,'C' from generate_series(1,681) returning id",
      [alice, cardId]
    )
  ).rows.map(row => row.id);

  const result = await authenticated(
    db,
    alice,
    "select public.discard_collection_cards($1::uuid[]) as balance",
    [ids]
  );
  assert.equal(result.rows[0].balance, 691);
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from public.user_cards where user_id=$1",
          [alice]
        )
      ).rows[0].count
    ),
    0
  );
});

test("bulk destruction is all-or-nothing for foreign, duplicate and locked cards", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    `insert into auth.users(id,raw_user_meta_data)
      values ($1,'{"pseudo":"BulkAlice"}'),($2,'{"pseudo":"BulkBob"}')`,
    [alice, bob]
  );
  await db.query(
    "insert into public.user_profiles(user_id,pseudo,karas_balance) values ($1,'BulkAlice',10),($2,'BulkBob',20) on conflict(user_id) do update set karas_balance=excluded.karas_balance",
    [alice, bob]
  );
  const cardId = (
    await db.query(`insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
      values ('bulk-atomic','Bulk atomic','Anime/Manga','Bulk','SR','https://example.test/atomic.png','test') returning id`)
  ).rows[0].id;
  const own = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$3,'SR'),($1,$3,'SR'),($2,$3,'SR') returning id",
      [alice, bob, cardId]
    )
  ).rows.map(row => row.id);

  await assert.rejects(
    authenticated(
      db,
      alice,
      "select public.discard_collection_cards($1::uuid[])",
      [[own[0], own[2]]]
    ),
    /CARD_NOT_OWNED/
  );
  await assert.rejects(
    authenticated(
      db,
      alice,
      "select public.discard_collection_cards($1::uuid[])",
      [[own[0], own[0]]]
    ),
    /CARD_SELECTION_INVALID/
  );
  await authenticated(
    db,
    alice,
    "select public.set_collection_card_locked($1,true)",
    [own[1]]
  );
  await assert.rejects(
    authenticated(
      db,
      alice,
      "select public.discard_collection_cards($1::uuid[])",
      [[own[0], own[1]]]
    ),
    /CARD_LOCKED/
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) from public.user_cards where id=any($1::uuid[])",
          [own]
        )
      ).rows[0].count
    ),
    3
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select karas_balance from public.user_profiles where user_id=$1",
          [alice]
        )
      ).rows[0].karas_balance
    ),
    10
  );
});
