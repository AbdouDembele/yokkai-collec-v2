import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const seller = "39000000-0000-4000-8000-000000000001",
  buyer = "39000000-0000-4000-8000-000000000002";

// #390: a lock conflict on one sale defers only that sale to the next cron run;
// business errors still abort the job, and nothing is half-settled.
test("settlement defers a deadlocked sale and settles the others", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"RetrySeller"}\'),($2,\'{"pseudo":"RetryBuyer"}\')',
    [seller, buyer]
  );
  await db.exec("update public.user_profiles set karas_balance=1000");
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('retry-test','Retry','Anime','Retry','SR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  const sales = [];
  for (let i = 0; i < 2; i++) {
    const copy = (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SR') returning id",
        [seller, card]
      )
    ).rows[0].id;
    sales.push({
      copy,
      auction: (
        await db.query(
          "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at) values ($1,$2,$3,10,100,15,now()-interval '1 minute') returning id",
          [copy, seller, buyer]
        )
      ).rows[0].id
    });
  }
  const [blocked, free] = sales;
  // Simulate the deadlock victim on the first sale's card transfer.
  await db.exec(`create function public.test_settlement_conflict() returns trigger language plpgsql as $$
    begin
      if new.id='${blocked.copy}' and current_setting('test.conflict',true)='on' then
        raise exception 'simulated' using errcode='40P01';
      end if;
      return new;
    end $$;
    create trigger test_settlement_conflict before update of user_id on public.user_cards
      for each row execute function public.test_settlement_conflict();`);
  const state = async () =>
    (
      await db.query(
        `select (select json_agg(status order by id) from public.auctions where id in ($1,$2)) statuses,
          (select json_agg(user_id order by id) from public.user_cards where id in ($3,$4)) owners,
          (select karas_balance from public.user_profiles where user_id=$5) seller_balance`,
        [blocked.auction, free.auction, blocked.copy, free.copy, seller]
      )
    ).rows[0];
  const order = [blocked, free].sort((a, b) =>
    a.auction < b.auction ? -1 : 1
  );
  const statusOf = (sale, sold, other) =>
    order.map(s => (s === sale ? sold : other));

  await db.exec("set test.conflict='on'");
  await db.query("select public.settle_expired_auctions()");
  let now = await state();
  assert.deepEqual(now.statuses, statusOf(free, "sold", "active"));
  assert.deepEqual(
    now.owners,
    [blocked, free]
      .sort((a, b) => (a.copy < b.copy ? -1 : 1))
      .map(s => (s === free ? buyer : seller)),
    "the deferred card stays with its seller"
  );
  assert.equal(now.seller_balance, 1100, "only the settled sale is credited");

  // Next cron run, conflict gone: the deferred sale settles exactly once.
  await db.exec("set test.conflict='off'");
  await db.query("select public.settle_expired_auctions()");
  now = await state();
  assert.deepEqual(now.statuses, ["sold", "sold"]);
  assert.deepEqual(now.owners, [buyer, buyer]);
  assert.equal(now.seller_balance, 1200);

  // Business errors are not swallowed: the job still fails loudly.
  await db.exec(
    "create or replace function public.test_settlement_conflict() returns trigger language plpgsql as $$ begin raise exception 'BUSINESS_ERROR'; end $$"
  );
  const copy = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SR') returning id",
      [seller, card]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.auctions(card_instance_id,seller_id,buyer_id,starting_price,current_price,duration_minutes,ends_at) values ($1,$2,$3,10,100,15,now()-interval '1 minute')",
    [copy, seller, buyer]
  );
  await assert.rejects(
    db.query("select public.settle_expired_auctions()"),
    /BUSINESS_ERROR/
  );
});
