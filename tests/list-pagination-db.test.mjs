import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";
const outsider = "10000000-0000-4000-8000-000000000003";

test("bounded trade and auction pages preserve complete player-visible lists", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [alice, "PageAlice"],
    [bob, "PageBob"],
    [outsider, "PageOther"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values ($1,$2,'accepted'),($2,$3,'accepted')",
    [alice, bob, outsider]
  );
  await db.query(
    `insert into public.trade_offers(from_user,to_user,offered_karas,status,created_at)
    select $1,$2,10,case when i%2=0 then 'accepted' else 'pending' end,
      '2026-01-01'::timestamptz + i*interval '1 second' from generate_series(1,251) i`,
    [alice, bob]
  );
  await db.query(
    "insert into public.trade_offers(from_user,to_user,offered_karas) values ($1,$2,10)",
    [bob, outsider]
  );
  const card = (
    await db.query(`insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values ('pages','Pages','Anime/Manga','Pages','C','https://example.test/card.png','test') returning id`)
  ).rows[0].id;
  await db.query(
    `with copies as (
    insert into public.user_cards(user_id,card_id,rarity)
      select $1,$2,'C' from generate_series(1,251) returning id
    ), numbered as (select id,row_number() over(order by id) i from copies)
    insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at,created_at)
      select id,$1,10,10,15,'2030-01-01'::timestamptz+i*interval '1 second',
        '2026-01-01'::timestamptz+i*interval '1 second' from numbered`,
    [bob, card]
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice
  ]);

  async function pages(name, size = 100) {
    let cursor = null;
    const items = [];
    let requests = 0;
    do {
      const page = (
        await db.query(`select public.${name}($1::jsonb,$2) as value`, [
          cursor,
          size
        ])
      ).rows[0].value;
      assert.ok(page.items.length <= Math.min(100, size));
      items.push(...page.items);
      requests++;
      assert.ok(requests < 500, "cursor must advance");
      cursor = page.nextCursor;
    } while (cursor);
    return { items, requests };
  }
  await t.test(
    "trade history: all statuses, ordering, page boundaries and privacy",
    async () => {
      const expected = (
        await db.query("select public.list_trade_offers() as value")
      ).rows[0].value;
      for (const size of [1, 100]) {
        const result = await pages("list_trade_offers_page", size);
        assert.deepEqual(result.items, expected);
        assert.equal(new Set(result.items.map(item => item.id)).size, 251);
      }
    }
  );
  await t.test(
    "auctions: complete list retains end-time order and mutable deadlines do not affect cursor",
    async () => {
      const expected = (
        await db.query("select public.list_auctions() as value")
      ).rows[0].value;
      const result = await pages("list_auctions_page");
      result.items.sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
      assert.deepEqual(result.items, expected);
      assert.equal(result.requests, 3);
      const first = (
        await db.query("select public.list_auctions_page(null,100) as value")
      ).rows[0].value;
      t.diagnostic(
        `auction payload: ${Buffer.byteLength(JSON.stringify(expected))} bytes legacy; ${Buffer.byteLength(JSON.stringify(first))} bytes first page (100/251)`
      );
      await db.exec("reset role");
      await db.query(
        "update public.auctions set ends_at='2031-01-01' where id=$1",
        [first.items[0].id]
      );
      await db.exec("set role authenticated");
      const second = (
        await db.query(
          "select public.list_auctions_page($1::jsonb,100) as value",
          [first.nextCursor]
        )
      ).rows[0].value;
      assert.ok(
        !second.items.some(item => first.items.some(old => old.id === item.id))
      );
      assert.equal(second.items.length, 100);
    }
  );
  await t.test(
    "equal timestamps never lose or repeat items across page boundaries",
    async () => {
      await db.exec("reset role");
      await db.exec(
        "update public.trade_offers set created_at='2026-01-01'; update public.auctions set created_at='2026-01-01'"
      );
      await db.exec("set role authenticated");
      for (const [name, legacy] of [
        ["list_trade_offers_page", "list_trade_offers"],
        ["list_auctions_page", "list_auctions"]
      ]) {
        const expected = (await db.query(`select public.${legacy}() as value`))
          .rows[0].value;
        const result = await pages(name);
        assert.deepEqual(
          result.items.map(item => item.id).sort(),
          expected.map(item => item.id).sort()
        );
        assert.equal(
          new Set(result.items.map(item => item.id)).size,
          expected.length
        );
      }
    }
  );
  await t.test(
    "page size cannot bypass cap; invalid limits and anonymous access are rejected",
    async () => {
      for (const name of ["list_trade_offers_page", "list_auctions_page"]) {
        assert.equal(
          (await db.query(`select public.${name}(null,10000) as value`)).rows[0]
            .value.items.length,
          100
        );
        await assert.rejects(
          db.query(`select public.${name}(null,0)`),
          /INVALID_PAGE_SIZE/
        );
        await db.exec("reset role");
        for (const role of ["public", "anon"])
          assert.equal(
            (
              await db.query(
                "select has_function_privilege($1,$2,'EXECUTE') as allowed",
                [role, `public.${name}(jsonb,integer)`]
              )
            ).rows[0].allowed,
            false
          );
        await db.exec("set role anon");
        await assert.rejects(db.query(`select public.${name}(null,10)`), {
          code: "42501"
        });
        await db.exec("reset role; set role authenticated");
      }
    }
  );
});
