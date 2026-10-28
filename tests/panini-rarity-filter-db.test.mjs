import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const viewer = "71000000-0000-4000-8000-000000000001";
const owner = "71000000-0000-4000-8000-000000000002";

test("le filtre de rareté du classeur précède la pagination et conserve les droits", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [id, pseudo] of [
    [viewer, "RarityViewer"],
    [owner, "RarityOwner"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.exec(`
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select 'rarity-lr-' || i, 'LR ' || lpad(i::text,3,'0'), 'ANIME/MANGA',
      'Album cible', 'LR', 'https://example.test/lr.png', 'rarity-test'
    from generate_series(1,61) i;
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values
      ('rarity-ssr','SSR cible','ANIME/MANGA','Album cible','SSR','https://example.test/a.png','rarity-test'),
      ('rarity-sr','SR cible','ANIME/MANGA','Album cible','SR','https://example.test/b.png','rarity-test'),
      ('rarity-r','R cible','ANIME/MANGA','Album cible','R','https://example.test/c.png','rarity-test'),
      ('rarity-c','C cible','ANIME/MANGA','Album cible','C','https://example.test/d.png','rarity-test'),
      ('rarity-cross','LR croisee','ANIME/MANGA','Autre licence','LR','https://example.test/e.png','rarity-test'),
      ('rarity-other','LR exclue','ANIME/MANGA','Autre licence','LR','https://example.test/f.png','rarity-test'),
      ('rarity-comics','LR comics','COMICS','Album cible','LR','https://example.test/g.png','rarity-test');
    insert into public.card_franchises(card_id,franchise,position)
    select id,'Album cible',1 from public.cards where source_id='rarity-cross';
    insert into public.user_cards(user_id,card_id,rarity)
    select '${viewer}',id,rarete_base from public.cards where source_id in ('rarity-lr-1','rarity-sr');
    insert into public.user_cards(user_id,card_id,rarity)
    select '${owner}',id,rarete_base from public.cards where source_id in ('rarity-cross','rarity-ssr');
    update public.user_profiles set is_public=false where user_id='${owner}';
  `);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer
  ]);
  const page = async ({
    rarity = "LR",
    offset = 0,
    limit = 28,
    query = "",
    category = "ANIME/MANGA",
    owned = false,
    friend = false
  } = {}) =>
    (
      await db.query(
        friend
          ? "select public.get_friend_panini_album_cards_page($7,'Album cible',$1,$2,$3,$4,$5,$6) as value"
          : "select public.get_panini_album_cards_page('Album cible',$1,$2,$3,$4,$5,$6) as value",
        friend
          ? [query, category, owned, offset, limit, rarity, owner]
          : [query, category, owned, offset, limit, rarity]
      )
    ).rows[0].value;

  await t.test(
    "LR filtrées sur toutes les pages, sans fuite d'une autre licence",
    async () => {
      const first = await page();
      assert.equal(first.total, 62);
      assert.equal(first.items.length, 28);
      assert.ok(first.items.every(card => card.rarity === "LR"));
      assert.equal(first.items.filter(card => card.owned).length, 1);
      const second = await page({ offset: 28 });
      const third = await page({ offset: 56 });
      const all = [...first.items, ...second.items, ...third.items];
      assert.equal(third.total, 62);
      assert.equal(third.items.length, 6);
      assert.equal(new Set(all.map(card => card.id)).size, 62);
      assert.ok(
        all.some(
          card => card.name === "LR CROISEE" && card.anime === "Autre licence"
        )
      );
      assert.ok(
        !all.some(card => ["LR EXCLUE", "LR COMICS"].includes(card.name))
      );
      assert.deepEqual(await page({ offset: 999 }), { items: [], total: 62 });
      assert.equal((await page({ limit: 999 })).items.length, 60);
    }
  );
  await t.test(
    "chaque rareté, recherche, catégorie et possessions se combinent",
    async () => {
      for (const rarity of ["SSR", "SR", "R", "C"]) {
        const result = await page({ rarity });
        assert.equal(result.total, 1);
        assert.equal(result.items[0].rarity, rarity);
      }
      assert.equal((await page({ rarity: " lr " })).total, 62);
      assert.equal((await page({ query: "croisee" })).total, 1);
      assert.equal((await page({ category: "COMICS" })).total, 1);
      assert.equal((await page({ category: "FILM" })).total, 0);
      const owned = await page({ owned: true });
      assert.equal(owned.total, 1);
      assert.equal(owned.items[0].name, "LR 001");
      assert.equal(owned.items[0].owned, true);
      await assert.rejects(page({ rarity: "INVALID" }), /INVALID_RARITY/);
      const all = await page({ rarity: "", limit: 60 });
      assert.equal(all.total, 66);
      const legacy = (
        await db.query(
          "select public.get_panini_album_cards_page('Album cible') as value"
        )
      ).rows[0].value;
      assert.equal(legacy.total, 67);
      assert.equal(legacy.items.length, 24);
    }
  );
  await t.test(
    "classeur d'un autre joueur : privé, public, ami et blocage",
    async () => {
      await assert.rejects(page({ friend: true }), /PROFILE_PRIVATE/);
      await db.exec("reset role");
      await db.query(
        "update public.user_profiles set is_public=true where user_id=$1",
        [owner]
      );
      await db.exec("set role authenticated");
      const publicPage = await page({ friend: true, owned: true });
      assert.equal(publicPage.total, 1);
      assert.equal(publicPage.items[0].name, "LR CROISEE");
      assert.equal(publicPage.items[0].owned, true);
      await db.exec("reset role");
      await db.query(
        "update public.user_profiles set is_public=false where user_id=$1",
        [owner]
      );
      await db.query(
        "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
        [viewer, owner]
      );
      await db.exec("set role authenticated");
      assert.equal((await page({ friend: true })).total, 62);
      const legacy = (
        await db.query(
          "select public.get_friend_panini_album_cards_page($1,'Album cible') as value",
          [owner]
        )
      ).rows[0].value;
      assert.equal(legacy.total, 67);
      await db.exec("reset role");
      await db.query(
        "insert into public.user_blocks(blocker_id,blocked_id) values($1,$2)",
        [owner, viewer]
      );
      await db.exec("set role authenticated");
      await assert.rejects(page({ friend: true }), /PROFILE_PRIVATE/);
    }
  );
  await t.test(
    "aucun accès anonyme, schéma fermé, anciens RPC conservés",
    async () => {
      await db.exec("reset role");
      for (const signature of [
        "public.get_panini_album_cards_page(text,text,text,boolean,integer,integer,text)",
        "public.get_friend_panini_album_cards_page(uuid,text,text,text,boolean,integer,integer,text)"
      ]) {
        for (const role of ["public", "anon", "authenticated"]) {
          const access = (
            await db.query(
              "select has_function_privilege($1,$2,'EXECUTE') as allowed",
              [role, signature]
            )
          ).rows[0];
          assert.equal(access.allowed, role === "authenticated");
        }
        const fn = (
          await db.query(
            "select proconfig from pg_proc where oid=$1::regprocedure",
            [signature]
          )
        ).rows[0];
        assert.ok(fn.proconfig.includes('search_path=""'));
      }
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await db.exec("set role authenticated");
      await assert.rejects(page(), /AUTH_REQUIRED/);
      await db.exec("set role anon");
      await assert.rejects(page(), /permission denied/);
    }
  );
});
