import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261009000004_auction_server_settlement.sql";
const sql = () =>
  readFileSync(
    new URL(`../supabase/migrations/${migration}`, import.meta.url),
    "utf8"
  );
const legacy = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter(n => n.endsWith(".sql") && n < migration)
  .sort();
const command = "select public.settle_expired_auctions();";
const seller = "10000000-0000-4000-8000-000000000001";
const buyer = "10000000-0000-4000-8000-000000000002";

async function fixture(db) {
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"CronSeller"}\'),($2,\'{"pseudo":"CronBuyer"}\')',
    [seller, buyer]
  );
  await db.exec("update public.user_profiles set karas_balance=100");
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('cron-test','Cron','Anime','Cron','SR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  const copy = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SR') returning id",
      [seller, card]
    )
  ).rows[0].id;
  const auction = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at) values ($1,$2,10,10,15,now()+interval '15 minutes') returning id",
      [copy, seller]
    )
  ).rows[0].id;
  return { copy, auction, card };
}
async function authenticated(db, id, statement, params = []) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try {
    return await db.query(statement, params);
  } finally {
    await db.exec("reset role");
  }
}
const readers = [
  "select public.list_auctions()",
  "select public.get_auction($1)",
  "select public.get_my_active_auction_cards()"
];

test("cron declares the exact postgres command every minute, idempotently", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const jobs = async () =>
    (
      await db.query(
        "select jobname,schedule,command,username,database,active from cron.job where jobname='settle-expired-auctions'"
      )
    ).rows;
  const expected = [
    {
      jobname: "settle-expired-auctions",
      schedule: "* * * * *",
      command,
      username: "postgres",
      database: "postgres",
      active: true
    }
  ];
  assert.deepEqual(await jobs(), expected);
  await db.exec(sql());
  assert.deepEqual(await jobs(), expected);
});

test("the server job settles sold and unsold auctions with no authenticated client", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const { copy, auction, card } = await fixture(db);
  await authenticated(db, buyer, "select public.place_bid($1,20)", [auction]);
  const other = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SR') returning id",
      [seller, card]
    )
  ).rows[0].id;
  const unsold = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,current_price,duration_minutes,ends_at) values ($1,$2,10,15,now()-interval '1 minute') returning id",
      [other, seller]
    )
  ).rows[0].id;
  await db.query(
    "update public.auctions set ends_at=now()-interval '1 minute' where id=$1",
    [auction]
  );
  await db.exec("set role postgres");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  assert.deepEqual(
    (await db.query("select current_user as role, auth.uid() as uid")).rows,
    [{ role: "postgres", uid: null }]
  );
  // Execute exactly the registered SQL, not a simulated scheduler or client RPC.
  await db.exec(command);
  assert.equal(
    (
      await db.query("select status from public.auctions where id=$1", [
        auction
      ])
    ).rows[0].status,
    "sold"
  );
  assert.equal(
    (await db.query("select status from public.auctions where id=$1", [unsold]))
      .rows[0].status,
    "expired"
  );
  assert.equal(
    (
      await db.query("select user_id from public.user_cards where id=$1", [
        copy
      ])
    ).rows[0].user_id,
    buyer
  );
  const balances = async () =>
    (
      await db.query(
        "select user_id,karas_balance from public.user_profiles order by user_id"
      )
    ).rows;
  assert.deepEqual(await balances(), [
    { user_id: seller, karas_balance: 120 },
    { user_id: buyer, karas_balance: 80 }
  ]);
  const notifications = async () =>
    Number(
      (
        await db.query(
          "select count(*) as n from public.notifications where type='auction_won' and reference_id=$1",
          [auction]
        )
      ).rows[0].n
    );
  assert.equal(await notifications(), 1);
  await db.exec(command);
  assert.equal(await notifications(), 1);
  assert.deepEqual(await balances(), [
    { user_id: seller, karas_balance: 120 },
    { user_id: buyer, karas_balance: 80 }
  ]);
  await assert.rejects(authenticated(db, buyer, command), { code: "42501" });
});

test("legacy readers still settle until migration; migrated readers never write", async t => {
  const { db } = await replayMigrations({ migrations: legacy });
  t.after(() => db.close());
  const { auction } = await fixture(db);
  for (const statement of readers) {
    await db.query(
      "update public.auctions set status='active',ends_at=now()-interval '1 minute' where id=$1",
      [auction]
    );
    await authenticated(
      db,
      seller,
      statement,
      statement.includes("$1") ? [auction] : []
    );
    assert.equal(
      (
        await db.query("select status from public.auctions where id=$1", [
          auction
        ])
      ).rows[0].status,
      "expired",
      `Before SQL deployment: ${statement}`
    );
  }
  await db.exec(sql());
  await db.query("update public.auctions set status='active' where id=$1", [
    auction
  ]);
  await db.exec("begin read only; set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    seller
  ]);
  for (const statement of readers)
    await db.query(statement, statement.includes("$1") ? [auction] : []);
  await db.exec("commit");
  assert.equal(
    (
      await db.query("select status from public.auctions where id=$1", [
        auction
      ])
    ).rows[0].status,
    "active"
  );
});

test("missing pg_cron refuses migration before removing legacy settlement", async t => {
  const { db } = await replayMigrations({ migrations: legacy });
  t.after(() => db.close());
  await db.exec("drop schema cron cascade");
  await assert.rejects(db.exec(sql()), /scripts\/admin\/enable-pg-cron\.sh/);
  await db.exec("rollback");
  const definitions = (
    await db.query(
      "select pg_get_functiondef(oid) as definition from pg_proc where oid=any($1::regprocedure[])",
      [
        [
          "public.list_auctions()",
          "public.get_auction(uuid)",
          "public.get_my_active_auction_cards()"
        ]
      ]
    )
  ).rows;
  assert.ok(
    definitions.every(r =>
      r.definition.includes("perform public.settle_expired_auctions();")
    )
  );
});

test("the client never invokes the private settlement RPC", () => {
  for (const file of [
    "lib/data/market.ts",
    "components/community-views.tsx",
    "components/game.tsx"
  ]) {
    assert.doesNotMatch(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      /settle_expired_auctions/
    );
  }
});
