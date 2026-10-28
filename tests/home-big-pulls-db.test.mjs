import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("big pulls enforce rarity, original ownership, visibility, moderation and authenticated-only access", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const users = Array.from(
    { length: 6 },
    (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
  for (const [index, id] of users.entries()) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2)",
      [id, JSON.stringify({ pseudo: `HomePlayer${index}` })]
    );
    await db.query(
      "insert into public.user_profiles(user_id,pseudo) values ($1,$2) on conflict(user_id) do update set pseudo=excluded.pseudo",
      [id, `HomePlayer${index}`]
    );
  }
  const [viewer, owner, banned, deleted, hidden, blocked] = users;
  await db.query(
    "insert into public.profile_media_assets(path,user_id,purpose,mime_type,animated,public_url) values($1,$2,'avatar','image/png',false,$3)",
    [owner + "/avatar.png", owner, "https://example.com/avatar.png"]
  );
  await db.query(
    "update public.user_profiles set avatar_url=$1 where user_id=$2",
    ["https://example.com/avatar.png", owner]
  );
  await db.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [banned]
  );
  await db.query(
    "insert into public.account_deletion_log(user_id) values($1)",
    [deleted]
  );
  await db.query(
    "update public.user_profiles set is_public=false where user_id=$1",
    [hidden]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [blocked, viewer]
  );
  const add = async (
    rarity,
    { user = owner, shiny = false, original = true, evolved = false } = {}
  ) => {
    const id = crypto.randomUUID();
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1::uuid,$1::text,'Home card','Manga','Home',$2,'https://example.com/card.png','home-test')",
      [id, rarity]
    );
    return (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_first_owner,is_evolved) values($1,$2,$3,$4,$5,$6) returning id",
        [user, id, rarity, shiny, original, evolved]
      )
    ).rows[0].id;
  };
  const ssr = await add("SSR");
  const lr = await add("LR");
  const shiny = await add("SSR", { shiny: true });
  for (const rarity of ["C", "R", "SR"]) await add(rarity);
  await add("LR", { original: false });
  await add("SSR", { shiny: true, evolved: true });
  const hiddenPull = await add("LR", { user: hidden });
  for (const user of [banned, deleted, blocked]) await add("LR", { user });
  const as = async (role, user, limit = 20) => {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? ""
    ]);
    try {
      return (
        await db.query("select public.get_recent_big_pulls($1) value", [limit])
      ).rows[0].value;
    } finally {
      await db.exec("reset role");
    }
  };
  await assert.rejects(as("anon", viewer), /permission denied/);
  await assert.rejects(as("service_role", viewer), /permission denied/);
  await assert.rejects(as("authenticated", null), /AUTH_REQUIRED/);
  await assert.rejects(as("authenticated", banned), /AUTH_REQUIRED/);
  await assert.rejects(as("authenticated", deleted), /AUTH_REQUIRED/);
  const pulls = await as("authenticated", viewer);
  assert.deepEqual(
    new Set(pulls.map(pull => pull.instanceId)),
    new Set([ssr, lr, shiny, hiddenPull])
  );
  assert.equal(pulls.length, 4);
  assert.equal((await as("authenticated", viewer, 1)).length, 1);
  assert.equal((await as("authenticated", viewer, null)).length, 4);
  assert.equal(pulls.filter(pull => pull.playerId === owner).length, 3);
  const anonymous = pulls.find(pull => pull.instanceId === hiddenPull);
  assert.equal(anonymous.playerId, null);
  assert.equal(anonymous.playerName, null);
  assert.equal(anonymous.avatarUrl, null);
  assert.equal(anonymous.profileStyle, null);
  assert.ok(
    pulls
      .filter(pull => pull.playerId === owner)
      .every(pull => pull.avatarUrl === "https://example.com/avatar.png")
  );
  assert.deepEqual(
    Object.keys(pulls[0]).sort(),
    [
      "avatarUrl",
      "card",
      "instanceId",
      "obtainedAt",
      "playerId",
      "playerName",
      "profileStyle"
    ].sort()
  );
  assert.deepEqual(
    Object.keys(pulls[0].card).sort(),
    ["anime", "category", "id", "image", "name", "rarity", "shiny"].sort()
  );
  assert.ok(
    pulls.every(
      (pull, index) =>
        index === 0 ||
        Date.parse(pull.obtainedAt) <= Date.parse(pulls[index - 1].obtainedAt)
    )
  );
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [viewer, hidden]
  );
  assert.equal(
    (await as("authenticated", viewer)).find(
      pull => pull.instanceId === hiddenPull
    ).playerId,
    null
  );
  await db.query(
    "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
    [viewer, hidden]
  );
  assert.equal(
    (await as("authenticated", viewer)).some(
      pull => pull.instanceId === hiddenPull
    ),
    false
  );
});
