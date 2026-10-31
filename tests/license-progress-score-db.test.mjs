import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
const id = n => "af310000-0000-4000-8000-" + String(n).padStart(12, "0");
test("Every distinct current card scores before a binder is complete; privacy and legacy formulas remain intact", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (let n = 1; n <= 11; n++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [
        id(n),
        JSON.stringify({ pseudo: "Progress" + String(n).padStart(2, "0") })
      ]
    );
  await db.exec(`alter table auth.users add column if not exists banned_until timestamptz;
  update public.anime_series_settings set enabled=true,license_grouping_enabled=true;
  insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url)
  select 'manual','progress-'||n,'Progress card '||n,case when n<=5 then 'Big Progress' when n=6 then 'Tiny Progress' else 'Partial Progress' end,'ANIME/MANGA',
  case n when 2 then 'R' when 3 then 'SR' when 4 then 'SSR' when 5 then 'LR' when 7 then 'SSR' else 'C' end::public.card_rarity,'https://example.test/p.png' from generate_series(1,8)n;
  insert into public.card_franchises(card_id,franchise,position) select id,'Big Progress Alias',1 from public.cards where source_id in('progress-1','progress-2','progress-3','progress-4','progress-5');`);
  const own = (user, nums) =>
    db.query(
      "insert into public.user_cards(user_id,card_id,rarity) select $1,id,rarete_base from public.cards where source_id=any($2::text[])",
      [id(user), nums.map(n => "progress-" + n)]
    );
  await own(1, [1, 2, 3, 4, 5, 7]);
  await own(2, [5]);
  await own(3, [6]);
  await own(4, [1]);
  await own(5, [5]);
  for (const user of [6, 7, 8, 9, 11]) await own(user, [1, 2, 3, 4, 5]);
  await db.exec(`insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved)
   select '${id(1)}',id,rarete_base,(n%3=1),(n%3=2) from public.cards cross join generate_series(1,40)n where source_id='progress-5';
   update public.user_profiles set is_public=false where user_id='${id(6)}';
   update auth.users set banned_until=now()+interval '1 day' where id='${id(7)}';
   insert into public.account_deletion_log(user_id) values('${id(8)}');
   insert into public.user_blocks(blocker_id,blocked_id) values('${id(9)}','${id(1)}');
   insert into public.friendships(user_id,friend_id,status) values('${id(1)}','${id(2)}','accepted');
   insert into public.leaderboard_rank_observations values('${id(1)}','licenses:completion-score:v1',(now() at time zone 'UTC')::date-7,99);`);
  const read = async (
    scope = "global:progress-score",
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
  const result = await read(),
    entry = n => result.entries.find(e => e.userId === id(n));
  assert.equal(result.metric, "completion-score");
  assert.equal(result.scoreVersion, 2);
  assert.deepEqual(result.completionWeights, {
    C: 1,
    R: 2,
    SR: 4,
    SSR: 8,
    LR: 15
  });
  assert.equal(result.mine.completionScore, 38);
  assert.equal(result.mine.completedLicenses, 2);
  assert.equal(entry(2).completionScore, 15);
  assert.equal(entry(2).completedLicenses, 0);
  assert(
    entry(2).position < entry(3).position,
    "An incomplete rare binder can outrank a completed one-card binder"
  );
  assert.equal(
    entry(2).position,
    entry(5).position,
    "Equal score and completion count share rank"
  );
  assert.equal(entry(3).completionScore, 1);
  assert.equal(entry(4).completionScore, 1);
  assert(
    entry(3).position < entry(4).position,
    "Completed count still breaks a score tie"
  );
  assert.equal(
    entry(11).completionScore,
    30,
    "Shared binder identities do not double card points"
  );
  assert.equal(
    result.history[id(1)].delta,
    null,
    "The new formula never compares ranks against v1"
  );
  for (const n of [6, 7, 8, 9]) {
    assert.equal(entry(n), undefined);
    assert.equal(result.profileStyles[id(n)], undefined);
    assert.equal(result.history[id(n)], undefined);
  }
  assert.equal(
    (await read("global:completion-score")).mine.completionScore,
    30,
    "Completed-only v1 is preserved"
  );
  assert.equal(
    (await read("global:completion-score", 2)).mine.completionScore,
    0
  );
  assert.equal(
    (await read("global:progress-score:legacy")).mine.completionScore,
    38
  );
  assert.deepEqual(
    new Set(
      (await read("global:progress-score", 1, 0, 100, "", true)).entries.map(
        e => e.userId
      )
    ),
    new Set([id(1), id(2)])
  );
  assert.deepEqual(
    (await read("global:progress-score", 1, 1, 2)).entries,
    result.entries.slice(1, 3)
  );
  assert.equal(
    (await read("global:progress-score", 1, 0, 100, "Progress02")).entries[0]
      .completionScore,
    15
  );
  const privateResult = await read("global:progress-score", 6);
  assert.equal(privateResult.mine.completionScore, 30);
  assert.equal(privateResult.mine.position, null);
  assert.equal(privateResult.history[id(6)], undefined);
  assert.equal(
    (await read("global:progress-score", 10)).mine.completionScore,
    0
  );
  await assert.rejects(read("global:progress-score", 7), /ACCOUNT_BANNED/);
  await assert.rejects(read("global:progress-score", 8), /PROFILE_MISSING/);
  await db.query(
    "delete from public.user_cards where user_id=$1 and card_id in(select id from public.cards where source_id='progress-7')",
    [id(1)]
  );
  assert.equal(
    (await read()).mine.completionScore,
    30,
    "Losing one incomplete-binder card only removes its own eight points"
  );
  await db.query(
    "delete from public.user_cards where user_id=$1 and card_id in(select id from public.cards where source_id='progress-5')",
    [id(1)]
  );
  assert.equal(
    (await read()).mine.completionScore,
    15,
    "The remaining incomplete binder still scores"
  );
  assert.equal((await read()).mine.completedLicenses, 0);
  assert.equal((await read("global:completion-score")).mine.completionScore, 0);
  await db.exec(
    "insert into public.cards(source,source_id,nom,franchise,categorie,rarete_base,image_url) values('manual','progress-new','New required card','Big Progress','ANIME/MANGA','C','https://example.test/new.png')"
  );
  assert.equal(
    (await read("global:progress-score", 11)).mine.completionScore,
    30,
    "Catalogue additions do not erase points already collected"
  );
  await assert.rejects(
    db.query("select public.get_license_leaderboard('global:progress-score')"),
    /AUTH_REQUIRED/
  );
  for (const role of ["anon", "service_role"]) {
    await db.exec("set role " + role);
    await assert.rejects(
      db.query(
        "select public.get_license_leaderboard('global:progress-score')"
      ),
      /permission denied/
    );
    await db.exec("reset role");
  }
});
