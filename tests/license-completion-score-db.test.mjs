import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const id = n => "ae310000-0000-4000-8000-" + String(n).padStart(12, "0");
const key = name =>
  "source:" +
  createHash("sha256")
    .update("ANIME/MANGA\x1f" + name)
    .digest("hex");
test("completion points reward rarity and completed binder size without multiplying shared cards, copies or variants", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (let n = 1; n <= 12; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [
        id(n),
        JSON.stringify({ pseudo: "Completion" + String(n).padStart(2, "0") })
      ]
    );
  await db.exec(`alter table auth.users add column if not exists banned_until timestamptz;
 update public.anime_series_settings set enabled=true,license_grouping_enabled=true;
 insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url)
 select 'manual','completion-'||n,'Completion card '||n,
 case when n<=5 then 'Large Binder' when n=6 then 'Solo LR' when n between 7 and 9 then 'Tiny '||n
 when n in(10,11) then 'Incomplete Pair' when n in(12,13) then 'Two Commons' else 'Single Common '||n end,
 'ANIME/MANGA',case when n in(5,6)then 'LR' when n=4 then 'SSR' when n in(3,10,11)then 'SR' when n=2 then 'R' else 'C' end::public.card_rarity,
 'https://example.test/card.png' from generate_series(1,15)n;
 insert into public.card_franchises(card_id,franchise,position) select id,'Large Alias',1 from public.cards where source_id in('completion-1','completion-2','completion-3','completion-4','completion-5');`);
  const own = async (user, nums) =>
    db.query(
      "insert into public.user_cards(user_id,card_id,rarity) select $1,id,rarete_base from public.cards where source_id=any($2::text[])",
      [id(user), nums.map(n => "completion-" + n)]
    );
  await own(1, [1, 2, 3, 4, 5, 10]);
  await own(2, [1, 2, 3, 4, 5]);
  await own(3, [6]);
  await own(4, [7, 8, 9]);
  await own(5, [1, 2]);
  await own(6, [12, 13]);
  await own(7, [14, 15]);
  for (const n of [8, 9, 10, 11]) await own(n, [1, 2, 3, 4, 5]);
  await db.exec(`insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved)
 select '${id(1)}',id,rarete_base,(n%3=1),(n%3=2) from public.cards cross join generate_series(1,40)n where source_id='completion-5';
 update public.user_profiles set is_public=false where user_id='${id(9)}';
 update auth.users set banned_until=now()+interval '1 day' where id='${id(10)}';
 insert into public.account_deletion_log(user_id) values('${id(11)}');
 insert into public.user_blocks(blocker_id,blocked_id) values('${id(8)}','${id(1)}');
 insert into public.friendships(user_id,friend_id,status) values('${id(1)}','${id(3)}','accepted');`);
  const read = async (
    scope = "global:completion-score",
    viewer = 1,
    offset = 0,
    limit = 100,
    query = "",
    friends = false
  ) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(viewer)
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          "select public.get_license_leaderboard($1,$2,$3,$4,$5) value",
          [scope, offset, limit, query, friends]
        )
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  await db.query(
    "insert into public.leaderboard_rank_observations(user_id,ranking_key,observed_day,position) values($1,'licenses:global:overall',(now() at time zone 'UTC')::date-7,50)",
    [id(1)]
  );
  const result = await read();
  const entry = n => result.entries.find(e => e.userId === id(n));
  assert.equal(result.metric, "completion-score");
  assert.equal(result.scoreVersion, 1);
  assert.deepEqual(result.completionWeights, {
    C: 1,
    R: 2,
    SR: 4,
    SSR: 8,
    LR: 15
  });
  assert.equal(result.mine.value, 30);
  assert.equal(result.mine.completionScore, 30);
  assert.equal(result.mine.completedLicenses, 2);
  assert.equal(
    entry(1).position,
    entry(2).position,
    "Equal score and completed count share rank regardless of other distinct cards"
  );
  assert.equal(entry(3).completionScore, 15);
  assert.equal(entry(4).completionScore, 3);
  assert(
    entry(1).position < entry(4).position,
    "A large binder beats more tiny completed binders"
  );
  assert.equal(entry(5).completionScore, 0);
  assert.equal(entry(5).completedLicenses, 0);
  assert.equal(entry(6).completionScore, 2);
  assert.equal(entry(7).completionScore, 2);
  assert(
    entry(7).position < entry(6).position,
    "Completed count breaks a score tie"
  );
  for (const n of [8, 9, 10, 11]) {
    assert.equal(entry(n), undefined);
    assert.equal(result.history[id(n)], undefined);
    assert.equal(result.profileStyles[id(n)], undefined);
  }
  assert.equal(
    result.history[id(1)].delta,
    null,
    "A new score never compares against the old formula"
  );
  const legacy = await read("global:completion-score:legacy");
  assert.equal(legacy.mine.completionScore, 30);
  const friends = await read("global:completion-score", 1, 0, 100, "", true);
  assert.deepEqual(
    new Set(friends.entries.map(e => e.userId)),
    new Set([id(1), id(3)])
  );
  assert.deepEqual(
    (await read("global:completion-score", 1, 1, 2)).entries,
    result.entries.slice(1, 3)
  );
  assert.equal((await read("global:completion-score", 1, -1, 999)).limit, 100);
  assert.equal(
    (await read("global:completion-score", 1, 0, 100, "Completion04"))
      .entries[0].completionScore,
    3
  );
  const privateResult = await read("global:completion-score", 9);
  assert.equal(privateResult.mine.position, null);
  assert.equal(privateResult.mine.completionScore, 30);
  assert.equal(privateResult.history[id(9)], undefined);
  await assert.rejects(read("global:completion-score", 10), /ACCOUNT_BANNED/);
  await assert.rejects(read("global:completion-score", 11), /PROFILE_MISSING/);
  assert.equal((await read("global:completion-score", 12)).mine.value, 0);
  // Losing the last required LR breaks both shared binders; incomplete points vanish.
  await db.query(
    "delete from public.user_cards where user_id=$1 and card_id in(select id from public.cards where source_id='completion-5')",
    [id(1)]
  );
  const lost = await read();
  assert.equal(lost.mine.completionScore, 0);
  assert.equal(lost.mine.completedLicenses, 0);
  // The unchanged per-license mode still measures distinct ownership.
  assert.equal((await read(key("Large Binder"))).mine.value, 4);
  // Catalogue changes recompute completion from the current membership set.
  await db.exec(
    "delete from public.user_cards where card_id in(select id from public.cards where source_id='completion-5');delete from public.cards where source_id='completion-5';"
  );
  assert.equal((await read()).mine.completionScore, 15);
  await assert.rejects(
    db.query(
      "select public.get_license_leaderboard('global:completion-score')"
    ),
    /AUTH_REQUIRED/
  );
  for (const role of ["anon", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query(
        "select public.get_license_leaderboard('global:completion-score')"
      ),
      /permission denied/
    );
    await db.exec("reset role");
  }
});
