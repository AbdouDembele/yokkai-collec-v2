import * as deletionCore from "../lib/server/account-deletion-core.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { generateKeyPairSync, sign } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    { exports, Date, URL, require: name => imports[name] }
  );
  return exports;
}

test("verified deletion action anonymizes auctions/trade/avatar on a disposable database", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const id = "10000000-0000-4000-8000-000000000001",
    other = "10000000-0000-4000-8000-000000000002",
    card = "20000000-0000-4000-8000-000000000001";
  await db.query(
    `insert into auth.users(id,raw_user_meta_data) values ($1,'{"pseudo":"EraseMe"}'),($2,'{"pseudo":"Survivor"}')`,
    [id, other]
  );
  await db.exec("update public.user_profiles set karas_balance=1000");
  await db.query(
    `insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values ($1,'ui-delete','CARD','ANIME/MANGA','TEST','C','https://example.test/card.jpg','manual')`,
    [card]
  );
  const owned = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$3,'C'),($2,$3,'C') returning id,user_id",
      [id, other, card]
    )
  ).rows;
  const sale = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,buyer_id,current_price,starting_price,duration_minutes,ends_at) values ($1,$2,$3,40,10,60,now()+interval '1 hour') returning id",
      [owned.find(r => r.user_id === id).id, id, other]
    )
  ).rows[0].id;
  const bid = (
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,buyer_id,current_price,starting_price,duration_minutes,ends_at) values ($1,$2,$3,30,10,60,now()+interval '1 minute') returning id",
      [owned.find(r => r.user_id === other).id, other, id]
    )
  ).rows[0].id;
  await db.query(
    "insert into public.bids(auction_id,bidder_id,amount) values ($1,$2,40),($3,$4,30)",
    [sale, other, bid, id]
  );
  await db.query(
    "update public.user_profiles set karas_balance=karas_balance-40 where user_id=$1",
    [other]
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted')",
    [id, other]
  );
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_karas,status) values ($1,$2,10,'pending')",
    [other, id]
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values ('avatars',$1,$2)",
    [`${id}/avatar.png`, id]
  );
  const admin = {
    rpc: async (name, args) => {
      await db.exec("reset role; set role service_role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      return {
        data: (await db.query(`select public.${name}($1) v`, [args.p_user_id]))
          .rows[0].v,
        error: null
      };
    },
    storage: {
      from: bucket => ({
        remove: async names => {
          assert.equal(bucket, "avatars");
          await db.exec("reset role");
          for (const name of names)
            await db.query(
              "delete from storage.objects where bucket_id='avatars' and name=$1",
              [name]
            );
          return { error: null };
        }
      })
    },
    auth: {
      admin: {
        deleteUser: async (uuid, soft) => {
          assert.equal(soft, false);
          await db.exec("reset role");
          await db.query("delete from auth.users where id=$1", [uuid]);
          return { error: null };
        }
      }
    }
  };
  const deletion = load("lib/server/account-deletion.ts", {
    "server-only": {},
    "./account-deletion-core.mjs": deletionCore,
    "@supabase/supabase-js": { createClient: () => admin },
    "@/lib/auth/session": {},
    "@/utils/supabase/config": {}
  });
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "disposable",
    alg: "RS256",
    use: "sig"
  };
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "disposable", typ: "JWT" })
  ).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: id,
      role: "authenticated",
      exp: now + 600,
      amr: [{ method: "oauth", timestamp: now }]
    })
  ).toString("base64url");
  const input = `${header}.${payload}`;
  const token = `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
  const sdk = createClient("https://disposable.invalid", "test-anon", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const verified = await sdk.auth.getClaims(token, { jwks: { keys: [jwk] } });
  assert.equal(verified.error, null);
  const forged = `${header}.${Buffer.from(JSON.stringify({ sub: id, role: "authenticated", exp: now + 600, auth_time: now })).toString("base64url")}.${token.split(".")[2]}`;
  assert.ok(
    (await sdk.auth.getClaims(forged, { jwks: { keys: [jwk] } })).error
  );
  const events = [];
  const client = {
    auth: {
      getClaims: () => sdk.auth.getClaims(token, { jwks: { keys: [jwk] } }),
      getUser: async () => ({ data: { user: { id } }, error: null }),
      signOut: async () => {
        events.push("signOut");
        return { error: null };
      }
    },
    rpc: async () => {
      await db.exec("reset role; set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id
      ]);
      return {
        data: (await db.query("select public.get_game_info() v")).rows[0].v,
        error: null
      };
    }
  };
  const { deleteAccountAction } = load("app/settings/actions.ts", {
    "next/headers": {
      cookies: async () => ({
        getAll: () => [{ name: "sb-example-auth-token" }],
        delete: () => events.push("cookie")
      })
    },
    "next/navigation": {
      redirect: path => {
        events.push(path);
        throw Error(`REDIRECT:${path}`);
      }
    },
    "next/cache": { revalidatePath: () => {} },
    "@/utils/supabase/server": { createClient: () => client },
    "@/utils/supabase/config": {
      getSupabaseConfig: () => ({ url: "https://example.test" })
    },
    "@/lib/auth/recent-auth": load("lib/auth/recent-auth.ts"),
    "@/lib/server/account-deletion": {
      deleteAccount: uuid => deletion.deleteAccount(uuid, admin)
    }
  });
  const form = new FormData();
  form.set("pseudo", "EraseMe");
  await assert.rejects(
    deleteAccountAction({}, form).then(state =>
      assert.fail(JSON.stringify(state))
    ),
    /REDIRECT:\/account-deleted/
  );
  assert.deepEqual(events, ["signOut", "cookie", "/account-deleted"]);
  await db.exec("reset role");
  for (const [sql, args] of [
    ["select count(*)::int n from auth.users where id=$1", [id]],
    ["select count(*)::int n from public.user_cards where user_id=$1", [id]],
    ["select count(*)::int n from storage.objects where owner_id=$1", [id]]
  ])
    assert.equal((await db.query(sql, args)).rows[0].n, 0);
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [other]
      )
    ).rows[0].karas_balance,
    1000
  );
  assert.deepEqual(
    (
      await db.query(
        "select status,buyer_id,current_price,ends_at>now()+interval '3 minutes' extended from public.auctions where id=$1",
        [bid]
      )
    ).rows[0],
    { status: "active", buyer_id: null, current_price: 10, extended: true }
  );
  assert.equal(
    (await db.query("select status from public.auctions where id=$1", [sale]))
      .rows[0].status,
    "expired"
  );
  assert.equal(
    (await db.query("select status from public.trade_offers")).rows[0].status,
    "cancelled"
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other
  ]);
  assert.equal(
    (await db.query("select public.get_auction($1) v", [sale])).rows[0].v
      .seller,
    "Joueur supprimé"
  );
  assert.equal(
    (await db.query("select public.list_trade_offers() v")).rows[0].v[0]
      .toPseudo,
    "Joueur supprimé"
  );
});
