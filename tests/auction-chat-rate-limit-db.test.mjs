import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = name =>
  readFileSync(
    new URL("../supabase/migrations/" + name + ".sql", import.meta.url),
    "utf8"
  );
const ids = [1, 2, 3, 4, 5].map(i => "10000000-0000-4000-8000-00000000000" + i);
const auctions = [1, 2].map(i => "20000000-0000-4000-8000-00000000000" + i);

test("chat : quotas globaux, mentions et notifications avec contre-preuves", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.auctions(id uuid primary key,seller_id uuid,status text,ends_at timestamptz);
    create table public.bids(auction_id uuid,bidder_id uuid);
    create table public.user_profiles(user_id uuid primary key,pseudo text,avatar_url text);
    create table public.auction_chat_messages(id uuid primary key default gen_random_uuid(),auction_id uuid,user_id uuid,message text,gif_url text,created_at timestamptz default clock_timestamp());
    create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid,type text,reference_id uuid,actor_user_id uuid,read_at timestamptz,created_at timestamptz default now(),unique(user_id,type,reference_id));
    create table public.user_blocks(blocker_id uuid,blocked_id uuid,primary key(blocker_id,blocked_id));
    grant usage on schema auth,public to authenticated;
  `);
  const blocks = migration("20261008000007_block_and_report");
  await db.exec(
    blocks.match(/create function public\.users_blocked[\s\S]*?\$\$;/)[0]
  );
  const original = migration("20261007000002_auction_chat_gifs").match(
    /create function public\.send_auction_chat_message[\s\S]*?end; \$\$;/
  )[0];
  await db.exec(original);
  await db.exec(
    "revoke all on function public.send_auction_chat_message(uuid,text,text) from public,anon; grant execute on function public.send_auction_chat_message(uuid,text,text) to authenticated;"
  );
  await db.exec(migration("20261013000004_auction_chat_rate_limit"));
  for (let i = 0; i < ids.length; i++)
    await db.query("insert into public.user_profiles values ($1,$2,null)", [
      ids[i],
      ["Alice", "Bob", "Charlie", "Diane", "Ernest"][i]
    ]);
  for (const auction of auctions) {
    await db.query(
      "insert into public.auctions values ($1,$2,'active',clock_timestamp()+interval '1 day')",
      [auction, ids[0]]
    );
    for (const id of ids.slice(1))
      await db.query("insert into public.bids values ($1,$2)", [auction, id]);
  }
  const send = async (
    id,
    message = "Bonjour",
    auction = auctions[0],
    gif = null
  ) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    try {
      return (
        await db.query(
          "select public.send_auction_chat_message($1,$2,$3) as value",
          [auction, message, gif]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  const age = () =>
    db.exec(
      "update public.auction_chat_messages set created_at=clock_timestamp()-interval '4 seconds'"
    );
  await t.test("espacement global et autre joueur indépendant", async () => {
    await send(ids[0]);
    await assert.rejects(
      send(ids[0], "Trop tôt", auctions[1]),
      e =>
        e.message === "CHAT_RATE_LIMITED" &&
        Number(e.detail) > 0 &&
        Number(e.detail) <= 3
    );
    await send(ids[1], "Autre joueur");
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from public.auction_chat_messages"
        )
      ).rows[0].n,
      2
    );
    await age();
    await send(ids[0], "Après espacement");
  });
  await t.test(
    "10 messages sur 60 secondes et reprise hors fenêtre",
    async () => {
      await db.exec("delete from public.auction_chat_messages");
      for (let i = 0; i < 10; i++)
        await db.query(
          "insert into public.auction_chat_messages(user_id,auction_id,message,created_at) values ($1,$2,'historique',clock_timestamp()-interval '5 seconds'-($3*interval '4 seconds'))",
          [ids[0], auctions[i % 2], i]
        );
      await assert.rejects(
        send(ids[0]),
        e =>
          e.message === "CHAT_RATE_LIMITED" &&
          Number(e.detail) >= 18 &&
          Number(e.detail) <= 20
      );
      await send(ids[1]);
      await db.exec(
        "update public.auction_chat_messages set created_at=clock_timestamp()-interval '61 seconds' where user_id='" +
          ids[0] +
          "'"
      );
      await send(ids[0]);
    }
  );
  await t.test(
    "3 personnes distinctes, casse et brouillon refusé sans insertion",
    async () => {
      await db.exec("delete from public.auction_chat_messages");
      await assert.rejects(
        send(ids[0], "@Bob @Charlie @Diane @Ernest"),
        e =>
          e.message === "CHAT_MENTION_INVALID" && e.detail === "max_mentions=3"
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.auction_chat_messages"
          )
        ).rows[0].n,
        0
      );
      await send(ids[0], "@Bob @bob @Charlie @Diane");
      assert.equal(
        (await db.query("select count(*)::int as n from public.notifications"))
          .rows[0].n,
        3
      );
      await assert.rejects(send(ids[1], "@Nobody"), /CHAT_MENTION_INVALID/);
    }
  );
  await t.test(
    "notification non lue intacte, renotification après 10 minutes et blocage",
    async () => {
      const notification = async () =>
        (
          await db.query(
            "select * from public.notifications where user_id=$1 and reference_id=$2",
            [ids[1], auctions[0]]
          )
        ).rows[0];
      const before = await notification();
      await send(ids[2], "@Bob");
      assert.deepEqual(await notification(), before);
      await db.exec(
        "update public.notifications set read_at=clock_timestamp() where user_id='" +
          ids[1] +
          "'"
      );
      const read = await notification();
      await send(ids[3], "@Bob");
      assert.deepEqual(await notification(), read);
      await db.exec(
        "update public.notifications set created_at=clock_timestamp()-interval '601 seconds' where user_id='" +
          ids[1] +
          "'"
      );
      await send(ids[4], "@Bob");
      const renewed = await notification();
      assert.equal(renewed.read_at, null);
      assert.equal(renewed.actor_user_id, ids[4]);
      assert.equal(renewed.id, before.id);
      await db.query("insert into public.user_blocks values ($1,$2)", [
        ids[1],
        ids[0]
      ]);
      await age();
      await send(ids[0], "@Bob", auctions[1]);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.notifications where user_id=$1 and reference_id=$2",
            [ids[1], auctions[1]]
          )
        ).rows[0].n,
        0
      );
      // Existing read row must also stay intact when the new actor is blocked.
      await db.exec(
        "update public.notifications set read_at=clock_timestamp(),created_at=clock_timestamp()-interval '601 seconds' where user_id='" +
          ids[1] +
          "'"
      );
      const blocked = await notification();
      await age();
      await send(ids[0], "@Bob");
      assert.deepEqual(await notification(), blocked);
    }
  );
  await t.test(
    "GIF inchangé, created_at explicite et index auteur",
    async () => {
      await db.exec("delete from public.auction_chat_messages");
      const gif = "https://media2.giphy.com/media/abc/giphy.gif";
      const sent = await send(ids[0], "", auctions[0], gif);
      assert.equal(sent.gifUrl, gif);
      assert.equal(sent.message, "GIF");
      const definition = (
        await db.query(
          "select pg_get_functiondef('public.send_auction_chat_message(uuid,text,text)'::regprocedure) as definition"
        )
      ).rows[0].definition;
      assert.match(
        definition,
        /pg_advisory_xact_lock\(1128808788,\s*pg_catalog\.hashtext/
      );
      assert.ok(
        definition.indexOf(
          "clock_timestamp()",
          definition.indexOf("pg_advisory_xact_lock")
        ) > definition.indexOf("pg_advisory_xact_lock")
      );
      assert.match(
        (
          await db.query(
            "select indexdef from pg_indexes where indexname='auction_chat_messages_user_created_idx'"
          )
        ).rows[0].indexdef,
        /user_id, created_at DESC/
      );
    }
  );
});
