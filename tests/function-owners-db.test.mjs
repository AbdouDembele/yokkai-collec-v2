import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const targets = [
  "can_view_collection(uuid, uuid)",
  "discard_collection_card(uuid)",
  "get_friend_collection(uuid)",
  "get_my_active_auction_cards()",
  "get_pack_destruction_values(uuid[])",
  "get_profile_privacy()",
  "notify_auction_sold()",
  "prevent_locked_card_transfer_or_delete()",
  "prevent_locked_trade_offer()",
  "remove_friend(uuid)",
  "set_collection_card_locked(uuid, boolean)",
  "set_profile_privacy(boolean)"
];
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";

test("canonical owners preserve all twelve RPC/helper/trigger paths with non-superuser postgres", async t => {
  const { db, migrations } = await replayMigrations();
  t.after(() => db.close());
  const catalogSql = readFileSync(
    new URL("../scripts/schema-catalog.sql", import.meta.url),
    "utf8"
  );
  const catalog = async () => (await db.query(catalogSql)).rows;
  const reference = await catalog();
  // Reproduce the observed production owners and ACLs, then its execution roles.
  await db.exec(
    "create role supabase_admin superuser bypassrls; grant anon, authenticated, service_role to postgres;"
  );
  for (const signature of targets)
    await db.exec(
      `alter function public.${signature} owner to supabase_admin; grant execute on function public.${signature} to postgres;`
    );
  const production = await catalog();
  assert.ok(
    (
      await db.query(
        "select proconfig from pg_proc where oid=any($1::regprocedure[])",
        [targets.map(s => `public.${s}`)]
      )
    ).rows.every(r => r.proconfig?.includes('search_path=""'))
  );
  // PGlite disallows ALTER ROLE (0A000); change this disposable role's catalog
  // flags to reproduce production, rather than test with a superuser owner.
  await db.exec(
    "set role supabase_admin; update pg_authid set rolsuper=false,rolbypassrls=true where rolname='postgres';"
  );
  const owners = async () =>
    (
      await db.query(
        `select pg_get_userbyid(proowner) as owner
    from pg_proc where oid=any($1::regprocedure[])`,
        [targets.map(s => `public.${s}`)]
      )
    ).rows;
  const canonical = async () =>
    assert.deepEqual(
      (await owners()).map(r => r.owner),
      targets.map(() => "postgres")
    );
  await assert.rejects(canonical(), { name: "AssertionError" });
  t.diagnostic(
    "Before: canonical-owner assertion rejects all 12 supabase_admin owners (simulated production)."
  );

  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"OwnerAlice"}\'),($2,\'{"pseudo":"OwnerBob"}\')',
    [alice, bob]
  );
  await db.query(
    "insert into public.user_profiles(user_id,pseudo,karas_balance) values ($1,'OwnerAlice',100),($2,'OwnerBob',100) on conflict(user_id) do update set karas_balance=100",
    [alice, bob]
  );
  const card = (
    await db.query(`insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values ('owner-test','Owner test','Anime','Owner test','SR','https://example.test/card.png','owner-test') returning id`)
  ).rows[0].id;
  const copies = [];
  for (const user of [alice, alice, alice, bob])
    copies.push(
      (
        await db.query(
          "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SR') returning id",
          [user, card]
        )
      ).rows[0].id
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted')",
    [alice, bob]
  );

  async function exercise() {
    await db.exec("begin");
    try {
      const call = async (sql, params = []) =>
        (await db.query(sql, params)).rows[0].value;
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        alice
      ]);
      assert.equal(
        await call("select public.set_profile_privacy(false) as value"),
        false
      );
      assert.equal(
        await call("select public.get_profile_privacy() as value"),
        false
      );
      const friendCards = await call(
        "select public.get_friend_collection($1) as value",
        [bob]
      );
      assert.equal(friendCards.length, 1); // Exercises can_view_collection as well.
      const values = await call(
        "select public.get_pack_destruction_values($1::uuid[]) as value",
        [[copies[1], copies[3]]]
      );
      assert.equal(values[copies[1]], 3);
      assert.equal(values[copies[3]], undefined);
      await call("select public.set_collection_card_locked($1,true) as value", [
        copies[0]
      ]);
      await db.exec("savepoint locked_delete");
      await assert.rejects(
        db.query("select public.discard_collection_card($1)", [copies[0]]),
        /CARD_LOCKED/
      );
      await db.exec("rollback to locked_delete; release locked_delete");
      const balance = await call(
        "select public.discard_collection_card($1) as value",
        [copies[1]]
      );
      assert.equal(balance, 103);
      // Owner-level writes exercise the two INVOKER triggers independently of RPC checks.
      await db.exec("set local role postgres; savepoint locked_trade");
      await assert.rejects(
        db.query(
          "insert into public.trade_offers(from_user,to_user,offered_card_ids) values ($1,$2,$3)",
          [alice, bob, [copies[0]]]
        ),
        /CARD_LOCKED/
      );
      await db.exec(
        "rollback to locked_trade; release locked_trade; savepoint locked_transfer"
      );
      await assert.rejects(
        db.query("update public.user_cards set user_id=$1 where id=$2", [
          bob,
          copies[0]
        ]),
        /CARD_LOCKED/
      );
      await db.exec("rollback to locked_transfer; release locked_transfer");
      const auction = (
        await db.query(
          `insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,current_price,buyer_id)
        values ($1,$2,10,15,now()-interval '1 minute',40,$3) returning id`,
          [copies[2], alice, bob]
        )
      ).rows[0].id;
      // Settlement now belongs to the postgres server job, not the read RPC.
      await db.query("select public.settle_expired_auctions()");
      await db.exec("set local role authenticated");
      assert.equal(
        await call("select public.remove_friend($1) as value", [bob]),
        true
      );
      assert.deepEqual(
        await call("select public.get_my_active_auction_cards() as value"),
        []
      );
      await db.exec("set local role postgres");
      assert.equal(
        (
          await db.query("select status from public.auctions where id=$1", [
            auction
          ])
        ).rows[0].status,
        "sold"
      );
      assert.equal(
        (
          await db.query("select user_id from public.user_cards where id=$1", [
            copies[2]
          ])
        ).rows[0].user_id,
        bob
      );
      assert.equal(
        Number(
          (
            await db.query(
              "select count(*) from public.notifications where user_id=$1 and type='auction_sold'",
              [alice]
            )
          ).rows[0].count
        ),
        1
      );
      return {
        balance,
        friendCards: friendCards.length,
        reward: values[copies[1]],
        sold: true,
        guards: 3
      };
    } finally {
      await db.exec("rollback");
    }
  }
  const before = await exercise();
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261008000011_align_function_owners.sql",
      import.meta.url
    ),
    "utf8"
  );
  await db.exec(migration);
  await canonical();
  assert.deepEqual(
    await catalog(),
    reference,
    "Only the twelve owner/owner-ACL differences are realigned; definitions, client grants, policies and triggers stay identical"
  );
  assert.deepEqual(await exercise(), before);
  assert.deepEqual(
    (
      await db.query(
        "select rolsuper,rolbypassrls from pg_roles where rolname='postgres'"
      )
    ).rows[0],
    { rolsuper: false, rolbypassrls: true }
  );
  for (const signature of targets)
    await db.exec(
      `alter function public.${signature} owner to supabase_admin; grant execute on function public.${signature} to postgres;`
    );
  assert.deepEqual(
    await catalog(),
    production,
    "Rollback restores the observed owners and grants"
  );
  await db.exec(migration);
  await db.exec("set role postgres");
  await db.exec(migration); // Future replay by the canonical owner is also valid.
  await canonical();
  t.diagnostic(
    `After: ${migrations.length} migrations replayed; 12 canonical owners; 12 RPC/helper/trigger paths preserved; postgres NOSUPERUSER BYPASSRLS.`
  );
});
