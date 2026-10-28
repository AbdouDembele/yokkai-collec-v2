import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261005000002_optimize_category_achievement_progress.sql",
    import.meta.url
  ),
  "utf8"
);
const indexMigration = readFileSync(
  new URL(
    "../supabase/migrations/20261005000001_cards_category_index.sql",
    import.meta.url
  ),
  "utf8"
);

const players = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "00000000-0000-0000-0000-000000000003",
  "00000000-0000-0000-0000-000000000004"
];

test("la progression par catégorie optimisée reste strictement identique", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table public.cards (
      id uuid primary key default gen_random_uuid(),
      categorie text,
      rarete_base text
    );
    create table public.user_cards (
      user_id uuid not null,
      card_id uuid not null references public.cards(id),
      is_shiny boolean not null default false
    );
    create table public.user_achievement_stats (
      user_id uuid primary key,
      regular_packs_opened integer not null default 0,
      decision_packs_completed integer not null default 0,
      auctions_won integer not null default 0,
      trades_completed integer not null default 0,
      ssr_evolved_to_lr integer not null default 0
    );
    create function public.achievement_progress(p_user_id uuid, p_condition_type text)
    returns integer language plpgsql stable security definer set search_path = ''
    as $$
    declare result integer;
    begin
      result := case p_condition_type
        when 'regular_packs_opened' then (select regular_packs_opened from public.user_achievement_stats where user_id=p_user_id)
        when 'decision_packs_completed' then (select decision_packs_completed from public.user_achievement_stats where user_id=p_user_id)
        when 'auctions_won' then (select auctions_won from public.user_achievement_stats where user_id=p_user_id)
        when 'trades_completed' then (select trades_completed from public.user_achievement_stats where user_id=p_user_id)
        when 'ssr_evolved_to_lr' then (select ssr_evolved_to_lr from public.user_achievement_stats where user_id=p_user_id)
        when 'unique_cards_collected' then (select count(distinct card_id) from public.user_cards where user_id=p_user_id)
        when 'first_lr_card' then (select case when exists(
          select 1 from public.user_cards uc join public.cards c on c.id=uc.card_id
          where uc.user_id=p_user_id and c.rarete_base='LR'
        ) then 1 else 0 end)
        when 'shiny_cards_collected' then (select count(*) from public.user_cards where user_id=p_user_id and is_shiny)
        when 'cards_collected_category_percent' then (
          select coalesce(max(floor(100.0*owned/total)::integer),0) from (
            select c.categorie, count(distinct uc.card_id) as owned,
              (select count(*) from public.cards all_cards where all_cards.categorie=c.categorie) as total
            from public.cards c left join public.user_cards uc on uc.card_id=c.id and uc.user_id=p_user_id
            group by c.categorie
          ) category_progress where total>0
        )
        else 0
      end;
      return coalesce(result,0);
    end;
    $$;
  `);
  assert.match(
    indexMigration,
    /create index concurrently if not exists cards_categorie_idx/i
  );
  assert.doesNotMatch(indexMigration, /\bbegin\b|\bcommit\b/i);
  await db.exec(indexMigration.replace(/ concurrently/i, ""));

  const addCards = async (category, count, rarity = "C") =>
    (
      await db.query(
        "insert into public.cards(categorie,rarete_base) select $1,$3 from generate_series(1,$2) returning id",
        [category, count, rarity]
      )
    ).rows.map(({ id }) => id);
  const alpha = await addCards("Alpha", 3);
  const beta = await addCards("Beta", 2);
  const gamma = await addCards("Gamma", 1, "LR");
  const uncategorized = await addCards(null, 1);
  await db.query(
    `insert into public.user_cards(user_id,card_id) values
    ($1,$5),
    ($2,$5),($2,$5),($2,$6),
    ($3,$5),($3,$6),($3,$7),($3,$8),($3,$9),($3,$10),
    ($4,$11)`,
    [...players, ...alpha, ...beta, ...gamma, ...uncategorized]
  );
  await db.query(
    "update public.user_cards set is_shiny=true where user_id=$1",
    [players[0]]
  );
  await db.query(
    `insert into public.user_achievement_stats
    (user_id,regular_packs_opened,decision_packs_completed,auctions_won,trades_completed,ssr_evolved_to_lr)
    select player,ordinality,ordinality+1,ordinality+2,ordinality+3,ordinality+4
    from unnest($1::uuid[]) with ordinality as players(player,ordinality)`,
    [players]
  );

  const conditions = [
    "regular_packs_opened",
    "decision_packs_completed",
    "auctions_won",
    "trades_completed",
    "ssr_evolved_to_lr",
    "unique_cards_collected",
    "first_lr_card",
    "shiny_cards_collected",
    "cards_collected_category_percent"
  ];
  const outputs = async () => {
    const values = [];
    for (const player of players) {
      for (const condition of conditions) {
        values.push(
          Number(
            (
              await db.query(
                "select public.achievement_progress($1,$2) value",
                [player, condition]
              )
            ).rows[0].value
          )
        );
      }
    }
    return values;
  };

  const before = await outputs();
  assert.deepEqual(
    before.filter((_, index) => index % conditions.length === 8),
    [33, 66, 100, 0]
  );
  await db.exec(migration);
  assert.deepEqual(await outputs(), before);

  await db.exec("truncate public.user_cards, public.cards");
  assert.equal(
    Number(
      (
        await db.query(
          "select public.achievement_progress($1,'cards_collected_category_percent') value",
          [players[0]]
        )
      ).rows[0].value
    ),
    0
  );
});
