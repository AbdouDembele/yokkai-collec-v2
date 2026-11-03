import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const migration = "20261103020000_stream_collection_ranking.sql";
const uid = n => `7e100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("streamed collection ranking preserves every score, rank, search, scope and immediate mutation", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync("supabase/migrations")
      .filter(n => n.endsWith(".sql") && n < migration)
      .sort()
  });
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id,raw_user_meta_data) select ('7e100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,jsonb_build_object('pseudo','PerfRank'||n) from generate_series(1,6)n;
 insert into public.cards(id,source_id,source,nom,franchise,categorie,rarete_base,image_url) select ('7e200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'perf-rank-'||n,'manual','Perf Rank '||n,'Performance','ANIME/MANGA',r::public.card_rarity,'https://example.test/rank.png' from unnest(array['C','R','SR','SSR','LR']) with ordinality x(r,n);
 insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved) select u.id,c.id,c.rarete_base,(v=1 or (v=2 and c.rarete_base='SSR')),(v=2) from auth.users u cross join public.cards c cross join generate_series(0,2)v cross join generate_series(1,7)copies where u.id::text like '7e100000-%' and c.source_id like 'perf-rank-%' and (v=0 or c.rarete_base in ('SSR','LR'));
 update public.user_profiles set is_public=false where user_id='${uid(3)}';
 insert into public.friendships(user_id,friend_id,status) values('${uid(1)}','${uid(2)}','accepted'),('${uid(1)}','${uid(4)}','pending');`);
  const cases = [];
  for (const viewer of [1, 3])
    for (const [offset, limit, query, friends] of [
      [0, 100, "", false],
      [1, 2, "", false],
      [0, 100, "PerfRank2", false],
      [0, 10, "%", false],
      [0, 100, "", true]
    ])
      cases.push({ viewer, args: [offset, limit, query, friends] });
  const read = async item => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid(item.viewer)
    ]);
    return (
      await db.query(
        "select public.get_collection_leaderboard($1,$2,$3,$4) result",
        item.args
      )
    ).rows[0].result;
  };
  const before = [];
  for (const item of cases) before.push(await read(item));
  const metadata = async () =>
    (
      await db.query(
        "select prosecdef,provolatile,proconfig,proacl::text from pg_proc where oid='public.leaderboard_collection_without_styles(integer,integer,text,boolean)'::regprocedure"
      )
    ).rows;
  const access = await metadata();
  await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  assert.deepEqual(await metadata(), access);
  for (let i = 0; i < cases.length; i++)
    assert.deepEqual(await read(cases[i]), before[i]);
  const initial = await read(cases[0]);
  assert.equal(initial.entries.length, 5);
  assert(!initial.entries.some(e => e.userId === uid(3)));
  assert(initial.mine.breakdown.some(e => e.variant === "shiny"));
  assert(initial.mine.breakdown.some(e => e.variant === "infinity"));
  await db.query("delete from public.user_cards where user_id=$1", [uid(1)]);
  const changed = await read(cases[0]);
  assert.equal(changed.mine.score, 0);
  assert(!changed.entries.some(e => e.userId === uid(1)));
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select public.get_collection_leaderboard(0,20,'',false)"),
    /permission denied/i
  );
  await db.exec("reset role");
});
