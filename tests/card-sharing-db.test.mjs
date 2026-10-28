import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = name =>
  readFileSync(
    new URL(`../supabase/migrations/${name}.sql`, import.meta.url),
    "utf8"
  );
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";

test("partages de cartes : surface publique minimale et limites transactionnelles", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
  `);
  await db.exec(migration("20260923000000_create_card_schema"));
  await db.exec(
    "alter table public.user_cards add column is_shiny boolean not null default false; alter table public.user_cards add column custom_image_url text"
  );
  await db.exec(migration("20260928000002_pseudo_availability"));
  await db.exec(`
    create function public.prevent_locked_card_transfer_or_delete() returns trigger language plpgsql as $$begin return new; end$$;
    create function public.prevent_locked_trade_offer() returns trigger language plpgsql as $$begin return new; end$$;
  `);
  await db.exec(migration("20261007000006_card_sharing"));
  await db.exec(migration("20261008000004_revoke_anon_trigger_helpers"));
  await db.exec(migration("20261008000005_list_card_shares"));
  await db.query("insert into auth.users values ($1),($2)", [alice, bob]);
  await db.query(
    "insert into public.user_profiles(user_id,pseudo) values ($1,'Alice'),($2,'Bob')",
    [alice, bob]
  );

  const cards = [];
  for (let index = 0; index < 13; index++) {
    const row = (
      await db.query(
        `insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
      values ($1,$2,'ANIME/MANGA',$3,$4,$5,'test') returning id`,
        [
          `card-${index}`,
          `Carte ${index}`,
          `Franchise ${index}`,
          ["C", "R", "SR", "SSR", "LR"][index % 5],
          `https://catalogue.example/card-${index}.png`
        ]
      )
    ).rows[0];
    cards.push(row.id);
  }
  const instances = [];
  for (let index = 0; index < 12; index++) {
    instances.push(
      (
        await db.query(
          "insert into public.user_cards(user_id,card_id,is_shiny) values ($1,$2,$3) returning id",
          [alice, cards[index], index === 3]
        )
      ).rows[0].id
    );
  }
  const bobInstance = (
    await db.query(
      "insert into public.user_cards(user_id,card_id) values ($1,$2) returning id",
      [bob, cards[12]]
    )
  ).rows[0].id;

  async function asUser(id, run, role = "authenticated") {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role })
    ]);
    try {
      return await run();
    } finally {
      await db.exec("reset role");
    }
  }
  const create = (instanceId, showPseudo = false) =>
    asUser(
      alice,
      async () =>
        (
          await db.query("select public.create_card_share($1,$2) as id", [
            instanceId,
            showPseudo
          ])
        ).rows[0].id
    );
  const read = (id, role = "anon") =>
    asUser(
      alice,
      async () =>
        (await db.query("select public.get_shared_card($1) as value", [id]))
          .rows[0].value,
      role
    );

  await t.test(
    "anon ne peut exécuter que les deux fonctions publiques prévues",
    async () => {
      const executable = (
        await db.query(`select p.oid::regprocedure::text as signature
      from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'
      and has_function_privilege('anon',p.oid,'EXECUTE') order by signature`)
      ).rows.map(row => row.signature);
      assert.deepEqual(executable, [
        "get_shared_card(text)",
        "is_pseudo_available(text)"
      ]);
      const rights = (
        await db.query(`select
      has_function_privilege('authenticated','public.create_card_share(uuid,boolean)','EXECUTE') as create_ok,
      has_function_privilege('authenticated','public.delete_card_share(text)','EXECUTE') as delete_ok,
      has_function_privilege('anon','public.create_card_share(uuid,boolean)','EXECUTE') as anon_create,
      has_function_privilege('anon','public.delete_card_share(text)','EXECUTE') as anon_delete`)
      ).rows[0];
      assert.deepEqual(rights, {
        create_ok: true,
        delete_ok: true,
        anon_create: false,
        anon_delete: false
      });
    }
  );

  await t.test(
    "lecture publique figée sans identifiant interne ni pseudo implicite",
    async () => {
      const id = await create(instances[3]);
      assert.match(id, /^[0-9a-f]{32}$/);
      await db.query(
        "update public.cards set nom='Nom modifié',franchise='Autre',rarete_base='C',image_url='https://catalogue.example/new.png' where id=$1",
        [cards[3]]
      );
      await db.query(
        "update public.user_profiles set pseudo='Nouveau pseudo' where user_id=$1",
        [alice]
      );
      const value = await read(id);
      assert.deepEqual(
        Object.keys(value).sort(),
        ["cardName", "catalogueImageUrl", "franchise", "rarity", "shiny"].sort()
      );
      assert.deepEqual(value, {
        cardName: "Carte 3",
        franchise: "Franchise 3",
        rarity: "SSR",
        shiny: true,
        catalogueImageUrl: "https://catalogue.example/card-3.png"
      });
      assert.equal(
        JSON.stringify(value).match(
          /owner|user|instance|cardId|chat|message/gi
        ),
        null
      );
      const shown = await read(await create(instances[4], true));
      assert.equal(shown.pseudo, "Nouveau pseudo");
    }
  );

  await t.test(
    "migration : reprise du jour UTC et journal inaccessible aux rôles clients",
    async () => {
      await db.exec(`insert into public.card_shares
      select repeat('e',32),card_id,owner_id,card_name,franchise,rarity,not shiny,
        show_pseudo,catalogue_image_url,display_pseudo,
        (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') - interval '1 second'
      from public.card_shares limit 1`);
      await db.exec("set timezone='Pacific/Honolulu'");
      await db.exec(migration("20261008000006_card_share_creation_limit"));
      await db.exec(migration("20261008000012_card_share_custom_images"));
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from public.card_share_creations"
          )
        ).rows[0].count,
        2
      );
      await db.exec("delete from public.card_shares where id=repeat('e',32)");
      assert.equal(
        (
          await db.query(
            "select relrowsecurity from pg_class where oid='public.card_share_creations'::regclass"
          )
        ).rows[0].relrowsecurity,
        true
      );
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const privilege of [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
          "REFERENCES",
          "TRIGGER"
        ]) {
          const allowed = (
            await db.query(
              "select has_table_privilege($1,'public.card_share_creations',$2) as allowed",
              [role, privilege]
            )
          ).rows[0].allowed;
          assert.equal(allowed, false, `${role} ${privilege}`);
        }
        await assert.rejects(
          asUser(
            alice,
            () => db.query("select * from public.card_share_creations"),
            role
          ),
          /permission denied/
        );
      }
      assert.equal(
        (
          await db.query(`select count(*)::int as count from pg_class c,
      lateral aclexplode(c.relacl) a where c.oid='public.card_share_creations'::regclass and a.grantee=0`)
        ).rows[0].count,
        0
      );
    }
  );

  await t.test(
    "identifiants invalides, trop longs et inconnus donnent exactement null",
    async () => {
      for (const id of [
        "",
        "xyz",
        "a".repeat(31),
        "a".repeat(33),
        "f".repeat(32)
      ])
        assert.equal(await read(id), null);
    }
  );

  await t.test(
    "la liste est authentifiée, limitée au propriétaire et sans identifiants internes",
    async () => {
      const list = id =>
        asUser(
          id,
          async () =>
            (await db.query("select public.list_card_shares() as value"))
              .rows[0].value
        );
      assert.equal(
        (
          await db.query(
            "select has_function_privilege('anon','public.list_card_shares(integer)','EXECUTE') as allowed"
          )
        ).rows[0].allowed,
        false
      );
      const mine = await list(alice);
      assert.equal(mine.length, 2);
      assert.deepEqual(
        Object.keys(mine[0]).sort(),
        ["id", "cardName", "rarity", "shiny", "showPseudo", "createdAt"].sort()
      );
      assert.deepEqual(await list(bob), []);
      assert.deepEqual(await list(null), []);
      assert.deepEqual(
        await asUser(
          alice,
          async () =>
            (await db.query("select public.list_card_shares(50) as value"))
              .rows[0].value
        ),
        []
      );
    }
  );

  await t.test(
    "possession obligatoire, déduplication avant plafond et plafond de dix",
    async () => {
      await assert.rejects(create(bobInstance), /CARD_NOT_OWNED/);
      const first = await create(instances[0]);
      assert.equal(await create(instances[0]), first);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from public.card_share_creations where owner_id=$1",
            [alice]
          )
        ).rows[0].count,
        3
      );
      // Two shares already exist from the snapshot test, then eight distinct additions reach ten.
      for (let index = 1; index <= 8; index++) await create(instances[index]);
      await assert.rejects(create(instances[9]), /CARD_SHARE_DAILY_LIMIT/);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from public.card_shares where owner_id=$1",
            [alice]
          )
        ).rows[0].count,
        10
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from public.card_share_creations where owner_id=$1",
            [alice]
          )
        ).rows[0].count,
        10
      );
      assert.equal(
        await create(instances[0]),
        first,
        "le doublon reste autorisé même au plafond"
      );
      const definition = (
        await db.query(
          "select pg_get_functiondef('public.create_card_share(uuid,boolean)'::regprocedure) as value"
        )
      ).rows[0].value;
      assert.match(definition, /pg_advisory_xact_lock/i);
    }
  );

  await t.test(
    "suppression réservée au propriétaire et effet public immédiat",
    async () => {
      const id = await create(instances[0]);
      const other = await asUser(
        bob,
        async () =>
          (
            await db.query("select public.delete_card_share($1) as deleted", [
              id
            ])
          ).rows[0].deleted
      );
      assert.equal(other, false);
      assert.ok(await read(id));
      const mine = await asUser(
        alice,
        async () =>
          (
            await db.query("select public.delete_card_share($1) as deleted", [
              id
            ])
          ).rows[0].deleted
      );
      assert.equal(mine, true);
      assert.equal(await read(id), null);
    }
  );

  await t.test(
    "dix créations puis toutes les suppressions : recréer est encore refusé",
    async () => {
      const ids = (
        await db.query("select id from public.card_shares where owner_id=$1", [
          alice
        ])
      ).rows;
      for (const { id } of ids)
        await asUser(alice, () =>
          db.query("select public.delete_card_share($1)", [id])
        );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from public.card_shares where owner_id=$1",
            [alice]
          )
        ).rows[0].count,
        0
      );
      await assert.rejects(create(instances[0]), /CARD_SHARE_DAILY_LIMIT/);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from public.card_share_creations where owner_id=$1",
            [alice]
          )
        ).rows[0].count,
        10
      );
    }
  );

  await t.test(
    "un autre joueur garde son plafond et la rétention nettoie seulement ses événements anciens",
    async () => {
      for (const owner of [alice, bob])
        await db.query(
          `insert into public.card_share_creations(owner_id,created_at)
      values ($1,now()-interval '8 days'),($1,now()-interval '6 days')`,
          [owner]
        );
      const id = await asUser(
        bob,
        async () =>
          (
            await db.query("select public.create_card_share($1,false) as id", [
              bobInstance
            ])
          ).rows[0].id
      );
      assert.ok(id);
      const count = async (owner, where = "true") =>
        (
          await db.query(
            `select count(*)::int as count
      from public.card_share_creations where owner_id=$1 and ${where}`,
            [owner]
          )
        ).rows[0].count;
      assert.equal(
        await count(bob),
        2,
        "une création récente et l'événement de six jours"
      );
      assert.equal(await count(bob, "created_at < now()-interval '7 days'"), 0);
      assert.equal(
        await count(alice, "created_at < now()-interval '7 days'"),
        1,
        "l'autre joueur n'est pas nettoyé"
      );
      assert.equal(
        await asUser(
          bob,
          async () =>
            (
              await db.query(
                "select public.create_card_share($1,false) as id",
                [bobInstance]
              )
            ).rows[0].id
        ),
        id
      );
      assert.equal(
        await count(bob),
        2,
        "la déduplication n'ajoute pas d'événement"
      );
    }
  );

  await t.test(
    "suppression puis recréation avant le plafond consomme deux créations",
    async () => {
      await db.exec("begin");
      try {
        await db.query(
          "delete from public.card_share_creations where owner_id=$1",
          [alice]
        );
        const first = await create(instances[0]);
        await asUser(alice, () =>
          db.query("select public.delete_card_share($1)", [first])
        );
        const next = await create(instances[0]);
        assert.notEqual(first, next);
        assert.equal(
          (
            await db.query(
              "select count(*)::int as count from public.card_share_creations where owner_id=$1",
              [alice]
            )
          ).rows[0].count,
          2
        );
        for (let index = 1; index <= 8; index++) await create(instances[index]);
        await db.exec("set role authenticated");
        await db.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({ sub: alice, role: "authenticated" })
        ]);
        await assert.rejects(
          db.query("select public.create_card_share($1,false)", [instances[9]]),
          /CARD_SHARE_DAILY_LIMIT/
        );
      } finally {
        await db.exec("rollback");
      }
    }
  );

  await t.test(
    "image personnalisée : création, actualisation gratuite du lien et retour au catalogue",
    async () => {
      await db.exec("begin");
      try {
        await db.query(
          "delete from public.card_share_creations where owner_id=$1",
          [alice]
        );
        await db.query(
          "update public.user_cards set custom_image_url='https://i.imgur.com/custom.png' where id=$1",
          [instances[0]]
        );
        const first = await create(instances[0]);
        assert.equal(
          (await read(first)).catalogueImageUrl,
          "https://i.imgur.com/custom.png"
        );
        const before = await read(first);
        await db.query(
          "update public.user_cards set custom_image_url='https://i.imgur.com/changed.gif' where id=$1",
          [instances[0]]
        );
        assert.equal(await create(instances[0]), first);
        assert.deepEqual(await read(first), {
          ...before,
          catalogueImageUrl: "https://i.imgur.com/changed.gif"
        });
        assert.equal(
          (
            await db.query(
              "select count(*)::int as count from public.card_share_creations where owner_id=$1",
              [alice]
            )
          ).rows[0].count,
          1
        );
        const otherCopy = (
          await db.query(
            "insert into public.user_cards(user_id,card_id,custom_image_url) values ($1,$2,'https://i.imgur.com/copy.png') returning id",
            [alice, cards[0]]
          )
        ).rows[0].id;
        assert.equal(await create(otherCopy), first);
        assert.equal(
          (await read(first)).catalogueImageUrl,
          "https://i.imgur.com/copy.png"
        );
        await db.query(
          "update public.user_cards set custom_image_url=null where id=$1",
          [instances[0]]
        );
        assert.equal(await create(instances[0]), first);
        assert.equal(
          (await read(first)).catalogueImageUrl,
          "https://catalogue.example/card-0.png"
        );
        for (let index = 1; index <= 9; index++) await create(instances[index]);
        await db.query(
          "update public.user_cards set custom_image_url='https://i.imgur.com/at-cap.png' where id=$1",
          [instances[0]]
        );
        assert.equal(
          await create(instances[0]),
          first,
          "l'actualisation est autorisée même au plafond"
        );
        assert.equal(
          (await read(first)).catalogueImageUrl,
          "https://i.imgur.com/at-cap.png"
        );
        assert.equal(
          (
            await db.query(
              "select count(*)::int as count from public.card_share_creations where owner_id=$1",
              [alice]
            )
          ).rows[0].count,
          10
        );
      } finally {
        await db.exec("rollback");
      }
    }
  );

  await t.test(
    "contre-preuve : l'ancienne fonction permet onze créations avec suppressions",
    async () => {
      const old = migration("20261007000006_card_sharing");
      const definition = old
        .slice(
          old.indexOf("create function public.create_card_share("),
          old.indexOf("create function public.get_shared_card(")
        )
        .replace("create function", "create or replace function");
      await db.exec("begin");
      try {
        await db.exec(definition);
        for (let index = 0; index < 11; index++) {
          const id = await create(instances[index]);
          assert.ok(id, "l'ancienne version contourne le plafond de créations");
          await asUser(alice, () =>
            db.query("select public.delete_card_share($1)", [id])
          );
        }
      } finally {
        await db.exec("rollback");
      }
      await assert.rejects(create(instances[0]), /CARD_SHARE_DAILY_LIMIT/);
    }
  );
});
