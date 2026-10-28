import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

// #379 (C2): every GIF a player writes must have a server-verified GIPHY
// rating of g, pg or pg-13; GIFs already published stay as they are.
test("GIF writes by players require a verified rating up to pg-13", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const [alice, bob] = [
    "37910000-0000-4000-8000-000000000001",
    "37910000-0000-4000-8000-000000000002"
  ];
  for (const [id, pseudo] of [
    [alice, "RatingAlice"],
    [bob, "RatingBob"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [alice, bob]
  );
  const gif = id => `https://media2.giphy.com/media/${id}/giphy.gif`;
  const as = async (role, user = "") => {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
  };
  const root = () => as("postgres");

  // Recording is server-only and validates the id; it reports the verdict.
  await as("authenticated", alice);
  await assert.rejects(
    db.query("select public.record_giphy_gif_rating('kind','g')"),
    /permission denied/
  );
  await assert.rejects(
    db.query("select 1 from public.giphy_gif_ratings"),
    /permission denied/
  );
  await as("service_role");
  const record = async (id, rating) =>
    (
      await db.query("select public.record_giphy_gif_rating($1,$2) allowed", [
        id,
        rating
      ])
    ).rows[0].allowed;
  for (const [id, rating, allowed] of [
    ["general", "g", true],
    ["parental", "PG", true],
    ["teen", "pg-13", true],
    ["youth", "y", false],
    ["restricted", "r", false]
  ])
    assert.equal(await record(id, rating), allowed, rating);
  await assert.rejects(record("../x", "g"), /GIF_INVALID/);
  await assert.rejects(record("valid", ""), /GIF_INVALID/);

  // End to end through the DM RPC, with GIPHY's v1 path and tracking query.
  await as("authenticated", alice);
  const send = (id, url) =>
    db.query("select public.send_private_message_gif($1,'',$2,$3)", [
      bob,
      id,
      url
    ]);
  for (const [n, id] of ["restricted", "youth", "unknown"].entries())
    await assert.rejects(
      send(`37910000-0000-4000-8000-00000000011${n}`, gif(id)),
      /GIF_RATING_REJECTED/,
      id
    );
  // Reading the id needs the exact GIPHY media shape.
  await assert.rejects(
    send(
      "37910000-0000-4000-8000-000000000120",
      "https://media.giphy.com/media/general/other/giphy.gif"
    ),
    /GIF_RATING_REJECTED/,
    "the id is the last segment, not any verified one"
  );

  // Refusals roll back before the sender rate limit counts them.
  await send(
    "37910000-0000-4000-8000-000000000101",
    "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/teen/giphy.gif?cid=abc&rid=giphy.gif&ct=g"
  );

  // The same fence covers every table that stores a player GIF.
  await root();
  const post = (
    await db.query(
      "insert into public.profile_wall_posts(id,user_id,body) values(gen_random_uuid(),$1,'Story') returning id",
      [alice]
    )
  ).rows[0].id;
  const card = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('gif-rating','Rating','Anime','Rating','SR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  const copy = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'SR') returning id",
      [bob, card]
    )
  ).rows[0].id;
  const auction = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at) values ($1,$2,10,10,15,now()+interval '1 hour') returning id",
      [copy, bob]
    )
  ).rows[0].id;
  const writes = {
    private_messages: url =>
      db.query(
        "insert into public.private_messages(id,sender_id,recipient_id,body,gif_url) values(gen_random_uuid(),$1,$2,'',$3)",
        [alice, bob, url]
      ),
    profile_wall_posts: url =>
      db.query(
        "insert into public.profile_wall_posts(id,user_id,body,gif_url) values(gen_random_uuid(),$1,'',$2)",
        [alice, url]
      ),
    wall_post_replies: url =>
      db.query(
        "insert into public.wall_post_replies(id,post_id,user_id,body,gif_url) values(gen_random_uuid(),$1,$2,'',$3)",
        [post, alice, url]
      ),
    auction_chat_messages: url =>
      db.query(
        "insert into public.auction_chat_messages(auction_id,user_id,message,gif_url) values($1,$2,'Hi',$3)",
        [auction, alice, url]
      )
  };
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  for (const [table, write] of Object.entries(writes)) {
    await assert.rejects(
      write(gif("restricted")),
      /GIF_RATING_REJECTED/,
      table
    );
    await write(gif("parental"));
  }
  await assert.rejects(
    db.query("update public.profile_wall_posts set gif_url=$2 where id=$1", [
      post,
      gif("restricted")
    ]),
    /GIF_RATING_REJECTED/,
    "updates are checked too"
  );

  // Rows written outside a player request (already published GIFs, operator
  // tooling) are not re-checked, and clearing or editing them stays possible.
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  const legacy = (
    await db.query(
      "insert into public.wall_post_replies(id,post_id,user_id,body,gif_url) values(gen_random_uuid(),$1,$2,'Old',$3) returning id",
      [post, alice, gif("restricted")]
    )
  ).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);
  await db.query(
    "update public.wall_post_replies set body='Edited' where id=$1",
    [legacy]
  );
  await db.query(
    "update public.wall_post_replies set gif_url=null where id=$1",
    [legacy]
  );
});
