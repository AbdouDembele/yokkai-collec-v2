import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const viewer = "10000000-0000-4000-8000-000000000001";
test("friendship pages preserve SQL order, every request and player privacy", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"PageViewer"}\')',
    [viewer]
  );
  await db.exec(`insert into auth.users(id,raw_user_meta_data)
    select md5('page-friend-'||i)::uuid,jsonb_build_object('pseudo',case when i%5=0 then 'Émile' else 'Friend' end||lpad(i::text,4,'0'))
    from generate_series(1,451) i`);
  await db.query(
    `insert into public.friendships(user_id,friend_id,status,created_at)
    select case when i%3=1 then md5('page-friend-'||i)::uuid else $1::uuid end,
      case when i%3=1 then $1::uuid else md5('page-friend-'||i)::uuid end,
      case when i%3=0 then 'accepted' else 'pending' end,
      '2026-01-01'::timestamptz + (i/3)*interval '1 second'
    from generate_series(1,451) i`,
    [viewer]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  const expected = (await db.query("select public.get_friendships() as value"))
    .rows[0].value;
  for (const size of [1, 100]) {
    const result = { friends: [], incoming: [], outgoing: [] };
    let cursor = null,
      requests = 0;
    do {
      const page = (
        await db.query(
          "select public.get_friendships_page($1::jsonb,$2) as value",
          [cursor, size]
        )
      ).rows[0].value;
      assert.ok(page.items.length <= size);
      for (const item of page.items) result[item.bucket].push(item.friend);
      cursor = page.nextCursor;
      requests++;
      assert.ok(requests < 500);
    } while (cursor);
    assert.deepEqual(result, expected);
    assert.equal(Object.values(result).flat().length, 451);
    t.diagnostic(
      `451 relationships: ${requests} requests at page size ${size}; identical lists and SQL ordering`
    );
  }
  assert.equal(
    (await db.query("select public.get_friendships_page(null,10000) as value"))
      .rows[0].value.items.length,
    100
  );
  await assert.rejects(
    db.query("select public.get_friendships_page(null,0)"),
    /INVALID_PAGE_SIZE/
  );
  await assert.rejects(
    db.query("select id from auth.users where id<>$1 limit 1", [viewer]),
    { code: "42501" }
  );
  await db.query(
    "select set_config('request.jwt.claim.sub',md5('page-friend-1')::uuid::text,false)"
  );
  const visible = (
    await db.query("select public.get_friendships_page(null,100) as value")
  ).rows[0].value;
  assert.equal(
    visible.items.length,
    1,
    "another player only sees their own relationship"
  );
  await db.exec("reset role");
  for (const role of ["public", "anon"]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.get_friendships_page(jsonb,integer)','EXECUTE') as allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
  }
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select public.get_friendships_page(null,100)"),
    { code: "42501" }
  );
});
