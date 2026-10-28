import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("Shiny rebalance changes only the new-draw threshold and advertised rate", async t => {
  const filename = "20261027190000_lr_shiny_one_percent.sql";
  const migrations = readdirSync("supabase/migrations")
    .filter(name => name.endsWith(".sql") && name < filename)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  await db.exec(`
    insert into auth.users(id,raw_user_meta_data)
      values(md5('shiny-preserved')::uuid,'{"pseudo":"ShinyPreserved"}');
    insert into public.cards(id,source_id,nom,categorie,rarete_base,image_url,source)
      values(md5('shiny-card')::uuid,'shiny-card','Shiny Card','ANIME/MANGA','LR','https://example.test/card.png','test');
    insert into public.user_cards(user_id,card_id,rarity,is_shiny)
      select md5('shiny-preserved')::uuid,md5('shiny-card')::uuid,'LR',flag
      from unnest(array[false,true]) flag;
    insert into public.decision_packs(id,user_id)
      values(md5('pending-pack')::uuid,md5('shiny-preserved')::uuid);
    insert into public.decision_pack_choices(pack_id,card_id,rarity,is_shiny,position)
      select md5('pending-pack')::uuid,md5('shiny-card')::uuid,'LR',i=1,i from generate_series(1,5)i;
  `);
  const snapshot = async () =>
    (
      await db.query(`select jsonb_build_object(
    'cards',(select jsonb_agg(to_jsonb(c) order by id) from public.user_cards c),
    'packs',(select jsonb_agg(to_jsonb(p) order by id) from public.decision_packs p),
    'choices',(select jsonb_agg(to_jsonb(c) order by id) from public.decision_pack_choices c),
    'profiles',(select jsonb_agg(to_jsonb(p) order by user_id) from public.user_profiles p)
  ) as state`)
    ).rows[0].state;
  const definitions = async () =>
    (
      await db.query(`
    select proname, pg_get_functiondef(oid) as definition, proacl, proowner, proconfig
    from pg_proc where oid in ('public.open_regular_pack()'::regprocedure,
      'public.open_decision_pack()'::regprocedure,'public.get_game_info()'::regprocedure)
    order by proname
  `)
    ).rows;
  const state = await snapshot();
  const before = await definitions();
  await db.exec(readFileSync("supabase/migrations/" + filename, "utf8"));
  const expected = before.map(row => ({
    ...row,
    definition:
      row.proname === "get_game_info"
        ? row.definition.replace("'shinyRate', 10", "'shinyRate', 1")
        : row.definition.replace(
            "shiny:=selected_card.rarete_base='LR' and random()<.1;",
            "shiny:=selected_card.rarete_base='LR' and random()<.01;"
          )
  }));
  assert.notDeepEqual(expected, before);
  assert.deepEqual(await definitions(), expected);
  assert.deepEqual(await snapshot(), state);
});
