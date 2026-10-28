import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = name =>
  readFileSync(
    new URL(`../supabase/migrations/${name}.sql`, import.meta.url),
    "utf8"
  );
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  c = "10000000-0000-4000-8000-000000000003";
const next = "20261008000007_block_and_report";

test("blocage et signalement : RPC réelles, confidentialitÃ© et contre-preuves", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,owner_id text);
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
  `);
  await db.exec(migration("20260923000000_create_card_schema"));
  await db.exec(`alter table public.user_cards add column is_shiny boolean default false,add column is_evolved boolean default false,
    add column is_first_owner boolean default true,add column folder_id uuid,add column custom_image_url text,add column is_locked boolean default false;
    alter table public.user_profiles add column karas_balance integer default 100;
    create table public.wishlist(user_id uuid,card_id uuid);
    create table public.achievements(id text primary key,titre text);
    create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid,type text,reference_id uuid,achievement_id text,
      read_at timestamptz,created_at timestamptz default now(),constraint notifications_type_check check(type in ('friend_request')),
      unique(user_id,type,reference_id));
    create table public.card_categories(name text);
    alter table public.notifications enable row level security;
    grant select on public.notifications to authenticated;
    create policy notifications_own on public.notifications for select to authenticated using(user_id=auth.uid());
  `);
  for (const name of [
    "20260924000005_auctions",
    "20260924000006_friendships",
    "20260924000007_trades",
    "20260924000008_profiles",
    "20260924000010_profile_banner",
    "20260926000001_friend_request_notifications",
    "20261003000008_social_avatars",
    "20261004000015_trade_progress_notifications",
    "20261005000000_cancel_trade_offer",
    "20261006000002_auction_bidder_chat",
    "20261007000000_auction_chat_mentions",
    "20261007000002_auction_chat_gifs",
    "20261008000001_friend_presence"
  ]) {
    let sql = migration(name);
    if (name === "20260926000001_friend_request_notifications")
      sql = sql.replace("drop constraint notifications_reference_id_fkey,", "");
    await db.exec(sql);
  }
  // Real admin predicate; storage/catalogue policies are outside this fixture.
  const admin = migration("20261003000000_admin_card_management");
  await db.exec(
    admin.slice(
      admin.indexOf("create table public.admin_users"),
      admin.indexOf("-- Admin catalogue writes")
    )
  );
  await db.exec(migration("20260928000002_pseudo_availability"));
  await db.exec(migration("20261007000006_card_sharing"));
  await db.exec(
    migration("20261004000005_lock_collection_cards").replace(
      "add column if not exists is_locked",
      "add column if not exists is_locked"
    )
  );
  await db.exec(migration("20261004000013_profile_collection_privacy"));
  await db.exec(migration("20261008000000_restore_public_profile_friends"));
  await db.exec(
    "revoke all on function public.list_notifications(integer) from public,anon; grant execute on function public.list_notifications(integer) to authenticated"
  );
  await db.exec(migration("20261008000004_revoke_anon_trigger_helpers"));
  await db.query("insert into auth.users values ($1),($2),($3)", [a, b, c]);
  await db.query(
    "insert into public.user_profiles(user_id,pseudo,last_seen_at,presence_active) values ($1,'Alice',now(),true),($2,'Bob',now(),true),($3,'Charlie',now(),true)",
    [a, b, c]
  );
  const original = (
    await db.query(
      "select proname,prosrc from pg_proc where pronamespace='public'::regnamespace and proname in ('create_trade_offer','respond_trade_offer','search_users','get_public_profile','get_profile') order by proname"
    )
  ).rows;
  await db.exec(migration(next));
  await db.exec(migration("20261009000003_audit_report_status_changes"));
  assert.deepEqual(
    (
      await db.query(
        "select proname,prosrc from pg_proc where pronamespace='public'::regnamespace and proname in ('create_trade_offer','respond_trade_offer','search_users','get_public_profile','get_profile') order by proname"
      )
    ).rows,
    original
  );
  const as = async (id, sql, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec("reset role");
    }
  };
  const call = async (id, name, args = []) =>
    (
      await as(
        id,
        `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
        args
      )
    )[0].value;
  const status = async () =>
    (
      await db.query(
        "select from_user,to_user,status from public.trade_offers order by from_user,to_user"
      )
    ).rows;
  await t.test("aucun droit direct et surface anon inchangée", async () => {
    assert.deepEqual(
      (
        await db.query(
          "select oid::regprocedure::text as signature from pg_proc where pronamespace='public'::regnamespace and has_function_privilege('anon',oid,'EXECUTE') order by signature"
        )
      ).rows.map(x => x.signature),
      ["get_shared_card(text)", "is_pseudo_available(text)"]
    );
    for (const table of ["user_blocks", "user_reports"])
      await assert.rejects(
        as(a, `select * from public.${table}`),
        /permission denied/
      );
    await assert.rejects(call(a, "admin_list_reports"), /ADMIN_REQUIRED/);
    await assert.rejects(
      call(a, "admin_set_report_status", [
        "10000000-0000-4000-8000-000000000010",
        "reviewed"
      ]),
      /ADMIN_REQUIRED/
    );
  });
  await t.test(
    "blocage retire amis, annule les deux sens et préserve le tiers et la présence",
    async () => {
      await db.query(
        "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted'),($1,$3,'accepted')",
        [a, b, c]
      );
      for (const [sender, recipient] of [
        [a, b],
        [b, a],
        [a, c]
      ])
        await call(sender, "create_trade_offer", [
          recipient,
          [],
          1,
          [],
          0,
          null
        ]);
      assert.equal(
        (await call(b, "get_friendships")).friends.find(x => x.id === a)
          .isOnline,
        true
      );
      await call(a, "block_user", [b]);
      assert.equal(
        (await call(a, "get_friendships")).friends.some(x => x.id === b),
        false
      );
      assert.equal(
        (await call(b, "get_friendships")).friends.some(x => x.id === a),
        false
      );
      assert.equal(
        (await call(b, "get_friendships")).friends.some(
          x => "lastSeenAt" in x && x.id === a
        ),
        false
      );
      assert.deepEqual(
        (await status()).map(x => [x.to_user, x.status]),
        [
          [b, "cancelled"],
          [c, "pending"],
          [a, "cancelled"]
        ]
      );
      assert.deepEqual(await call(b, "list_blocked_users"), []);
      assert.equal((await call(a, "list_blocked_users"))[0].id, b);
      assert.deepEqual(
        (await as(a, "select public.list_notifications() as value"))[0].value,
        []
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.notifications where type='trade_offer_cancelled'"
          )
        ).rows[0].n,
        0
      );
      await call(a, "block_user", [b]);
      assert.equal((await call(a, "list_blocked_users")).length, 1);
      await assert.rejects(call(a, "block_user", [a]), /ACTION_UNAVAILABLE/);
      for (const [sender, recipient] of [
        [a, b],
        [b, a],
        [a, a]
      ])
        await assert.rejects(
          call(sender, "send_friend_request", [recipient]),
          /ACTION_UNAVAILABLE/
        );
      await call(a, "unblock_user", [b]);
      const request = await call(b, "send_friend_request", [a]);
      assert.equal((await call(a, "get_friendships")).incoming.length, 1);
      await call(a, "block_user", [b]);
      await assert.rejects(
        call(a, "respond_friend_request", [request, true]),
        /ACTION_UNAVAILABLE/
      );
      assert.equal((await call(a, "get_friendships")).incoming.length, 0);
      assert.equal((await call(b, "get_friendships")).outgoing.length, 0);
      assert.equal(
        (await status()).filter(x => x.status === "cancelled").length,
        2
      );
    }
  );
  await t.test(
    "gardes SQL refusent création et acceptation bloquées sans transfert partiel",
    async () => {
      await assert.rejects(
        call(a, "create_trade_offer", [b, [], 1, [], 0, null]),
        /FRIENDS_ONLY/
      );
      const pending = (
        await db.query(
          "insert into public.trade_offers(from_user,to_user,offered_karas) values ($1,$2,1) returning id",
          [a, c]
        )
      ).rows[0].id;
      await db.query(
        "insert into public.user_blocks(blocker_id,blocked_id) values ($1,$2)",
        [c, a]
      );
      const before = (
        await db.query(
          "select user_id,karas_balance from public.user_profiles order by user_id"
        )
      ).rows;
      await assert.rejects(
        call(c, "respond_trade_offer", [pending, "accept"]),
        /ACTION_UNAVAILABLE/
      );
      assert.deepEqual(
        (
          await db.query(
            "select user_id,karas_balance from public.user_profiles order by user_id"
          )
        ).rows,
        before
      );
      assert.equal(
        (
          await db.query("select status from public.trade_offers where id=$1", [
            pending
          ])
        ).rows[0].status,
        "pending"
      );
      await assert.rejects(
        call(a, "create_trade_offer", [c, [], 1, [], 0, null]),
        /ACTION_UNAVAILABLE/
      );
      await db.query(
        "delete from public.user_blocks where blocker_id=$1 and blocked_id=$2",
        [c, a]
      );
    }
  );
  let auction, message;
  await t.test(
    "100 messages bloqués ne cachent pas les autres ; filtre directionnel et mentions",
    async () => {
      auction = (
        await db.query(
          "insert into public.auctions(seller_id,duration_minutes,ends_at,current_price) values ($1,60,now()+interval '1 hour',10) returning id",
          [a]
        )
      ).rows[0].id;
      await db.query(
        "insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,10),($1,$3,10)",
        [auction, b, c]
      );
      message = await call(c, "send_auction_chat_message", [
        auction,
        "Visible",
        null
      ]);
      await db.query(
        "insert into public.auction_chat_messages(auction_id,user_id,message,created_at) select $1,$2,'MasquÃ©',now()+i*interval '1 second' from generate_series(1,100) i",
        [auction, b]
      );
      assert.deepEqual(
        (await call(a, "get_auction_chat", [auction])).messages.map(
          x => x.message
        ),
        ["Visible"]
      );
      assert.equal(
        (await call(b, "get_auction_chat", [auction])).messages.length,
        100
      );
      const mine = await call(a, "send_auction_chat_message", [
        auction,
        "Auteur A",
        null
      ]);
      await db.query(
        "update public.auction_chat_messages set created_at=now()+interval '2 hours' where id=$1",
        [mine.id]
      );
      assert.equal(
        (await call(b, "get_auction_chat", [auction])).messages.some(
          x => x.id === mine.id
        ),
        true
      );
      await call(b, "send_auction_chat_message", [auction, "@Alice", null]);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.notifications where user_id=$1 and type='auction_chat_mention'",
            [a]
          )
        ).rows[0].n,
        0
      );
      await call(c, "send_auction_chat_message", [auction, "@Alice", null]);
      assert.equal(
        (await call(a, "list_notifications")).some(
          x => x.type === "auction_chat_mention"
        ),
        true
      );
    }
  );
  await t.test(
    "signalement : NULLS NOT DISTINCT, copie serveur, plafond et lecture admin",
    async () => {
      await assert.rejects(
        call(a, "report_user", [a, "other", "profile", null, "", false]),
        /REPORT_INVALID/
      );
      await assert.rejects(
        call(a, "report_user", [
          b,
          "other",
          "profile",
          null,
          "x".repeat(501),
          false
        ]),
        /REPORT_INVALID/
      );
      await call(a, "report_user", [
        b,
        "harassment",
        "profile",
        null,
        "",
        false
      ]);
      await assert.rejects(
        db.query(
          "insert into public.user_reports(reporter_id,reported_id,reason,context_type) values ($1,$2,'other','profile')",
          [a, b]
        ),
        /duplicate key/
      );
      const textReport = await call(a, "report_user", [
        c,
        "harassment",
        "auction_chat",
        message.id,
        "",
        false
      ]);
      await db.query(
        "update public.auction_chat_messages set message='Modifié' where id=$1",
        [message.id]
      );
      assert.deepEqual(
        (
          await db.query(
            "select snapshot from public.user_reports where id=$1",
            [textReport]
          )
        ).rows[0].snapshot,
        { message: "Visible", gifUrl: null }
      );
      await assert.rejects(
        call(a, "report_user", [b, "spam", "profile", null, "", false]),
        /REPORT_DUPLICATE/
      );
      await assert.rejects(
        call(a, "report_user", [
          b,
          "spam",
          "auction_chat",
          message.id,
          "",
          false
        ]),
        /REPORT_INVALID/
      );
      const gif = await call(c, "send_auction_chat_message", [
        auction,
        "",
        "https://media.giphy.com/media/example/giphy.gif"
      ]);
      const report = await call(a, "report_user", [
        c,
        "inappropriate",
        "auction_chat",
        gif.id,
        "DÃ©tail",
        false
      ]);
      await db.query(
        "update public.auction_chat_messages set gif_url='https://i.giphy.com/changed.gif' where id=$1",
        [gif.id]
      );
      assert.deepEqual(
        (
          await db.query(
            "select snapshot from public.user_reports where id=$1",
            [report]
          )
        ).rows[0].snapshot,
        {
          message: "GIF",
          gifUrl: "https://media.giphy.com/media/example/giphy.gif"
        }
      );
      for (let i = 0; i < 7; i++) {
        const item = await call(c, "send_auction_chat_message", [
          auction,
          "Texte " + i,
          null
        ]);
        await call(a, "report_user", [
          c,
          "spam",
          "auction_chat",
          item.id,
          "",
          false
        ]);
      }
      await assert.rejects(
        call(a, "report_user", [c, "other", "profile", null, "", true]),
        /REPORT_LIMIT/
      );
      assert.equal(
        (await call(a, "list_blocked_users")).some(x => x.id === c),
        false
      );
      await db.query("insert into public.admin_users(user_id) values ($1)", [
        c
      ]);
      assert.equal((await call(c, "admin_list_reports")).length, 10);
      await call(c, "admin_set_report_status", [report, "reviewed"]);
      assert.equal(
        (
          await db.query("select status from public.user_reports where id=$1", [
            report
          ])
        ).rows[0].status,
        "reviewed"
      );
      assert.deepEqual(
        (
          await db.query(
            "select admin_user_id,action,metadata from public.admin_audit_logs where action='report.status.change'"
          )
        ).rows,
        [
          {
            admin_user_id: c,
            action: "report.status.change",
            metadata: {
              report_id: report,
              target_user_id: c,
              previous_status: "pending",
              new_status: "reviewed"
            }
          }
        ]
      );
      await call(c, "admin_set_report_status", [report, "reviewed"]);
      assert.equal(
        (
          await db.query(
            "select count(*)::int count from public.admin_audit_logs where action='report.status.change'"
          )
        ).rows[0].count,
        1
      );
      assert.deepEqual(await call(b, "list_blocked_users"), []);
      await call(b, "report_user", [c, "other", "profile", null, "", true]);
      assert.equal((await call(b, "list_blocked_users"))[0].id, c);
    }
  );
});
