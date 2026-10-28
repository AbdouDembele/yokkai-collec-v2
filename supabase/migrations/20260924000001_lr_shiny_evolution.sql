begin;

alter table public.user_cards
  add column rarity public.card_rarity,
  add column is_shiny boolean not null default false,
  add column is_evolved boolean not null default false;

update public.user_cards as owned
  set rarity = cards.rarete_base
  from public.cards as cards
  where cards.id = owned.card_id;

alter table public.user_cards
  alter column rarity set not null,
  add constraint user_cards_shiny_high_rarity_check
    check (not is_shiny or rarity in ('SSR', 'LR')),
  add constraint user_cards_evolved_shiny_ssr_check
    check (not is_evolved or (rarity = 'SSR' and is_shiny));

create index user_cards_evolution_idx
  on public.user_cards (user_id, card_id, rarity, date_obtention, id);

create or replace function public.get_game_info()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  player_name text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select pseudo into player_name from public.user_profiles where user_id = player_id;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'user', jsonb_build_object('id', player_id, 'name', player_name),
    'categories', (select coalesce(jsonb_agg(categorie order by categorie), '[]'::jsonb)
      from (select distinct categorie from public.cards) as categories),
    'rarities', jsonb_build_array('C', 'R', 'SR', 'SSR', 'LR'),
    'dropRates', '[{"rarity":"C","percent":59},{"rarity":"R","percent":25},{"rarity":"SR","percent":10},{"rarity":"SSR","percent":5},{"rarity":"LR","percent":1}]'::jsonb,
    'shinyRate', 5
  );
end;
$$;

create or replace function public.open_regular_pack()
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  deadline timestamptz;
  server_now timestamptz;
  pool_sizes bigint[];
  rarity_index integer;
  rarities public.card_rarity[] := array['C', 'R', 'SR', 'SSR', 'LR']::public.card_rarity[];
  roll double precision;
  shiny boolean;
  selected_card public.cards%rowtype;
  copy_id uuid;
  result jsonb := '[]'::jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select next_regular_pack_at into deadline from public.user_profiles
    where user_id = player_id for update;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  server_now := clock_timestamp();
  if deadline > server_now then raise exception 'PACK_NOT_READY' using errcode = 'P0001'; end if;

  select array[
    count(*) filter (where rarete_base = 'C'), count(*) filter (where rarete_base = 'R'),
    count(*) filter (where rarete_base = 'SR'), count(*) filter (where rarete_base = 'SSR'),
    count(*) filter (where rarete_base = 'LR')
  ] into pool_sizes from public.cards;
  if 0 = any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE' using errcode = 'P0001'; end if;

  for position in 1..5 loop
    roll := random();
    rarity_index := case when roll < 0.59 then 1 when roll < 0.84 then 2
      when roll < 0.94 then 3 when roll < 0.99 then 4 else 5 end;
    select * into selected_card from public.cards
      where rarete_base = rarities[rarity_index] order by id
      offset floor(random() * pool_sizes[rarity_index])::bigint limit 1;
    if not found then raise exception 'CATALOGUE_INCOMPLETE' using errcode = 'P0001'; end if;
    shiny := selected_card.rarete_base = 'LR' and random() < 0.05;
    insert into public.user_cards (user_id, card_id, date_obtention, rarity, is_shiny, is_evolved)
      values (player_id, selected_card.id, server_now, selected_card.rarete_base, shiny, false)
      returning id into copy_id;
    result := result || jsonb_build_array(jsonb_build_object(
      'id', selected_card.id, 'name', selected_card.nom, 'category', selected_card.categorie,
      'rarity', selected_card.rarete_base, 'image', selected_card.image_url,
      'instanceId', copy_id, 'obtainedAt', server_now, 'shiny', shiny, 'isEvolved', false
    ));
  end loop;
  update public.user_profiles
    set next_regular_pack_at = greatest(deadline, server_now - interval '60 minutes') + interval '15 minutes'
    where user_id = player_id;
  return result;
end;
$$;

create function public.evolve_ssr_card(p_card_instance_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  target_card public.cards%rowtype;
  consumed_ids uuid[];
  evolved_id uuid;
  evolved_at timestamptz := clock_timestamp();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select cards.* into target_card
    from public.user_cards as owned
    join public.cards as cards on cards.id = owned.card_id
    where owned.id = p_card_instance_id and owned.user_id = player_id
      and cards.rarete_base = 'SSR' and not owned.is_shiny
    for update of owned;
  if not found then raise exception 'SSR_CARD_NOT_OWNED' using errcode = 'P0001'; end if;

  select array_agg(id order by date_obtention, id) into consumed_ids
    from (select owned.id, owned.date_obtention from public.user_cards owned
      join public.cards cards on cards.id = owned.card_id
      where owned.user_id = player_id and owned.card_id = target_card.id
        and cards.rarete_base = 'SSR' and not owned.is_shiny
      order by owned.date_obtention, owned.id limit 3 for update of owned) as copies;
  if coalesce(cardinality(consumed_ids), 0) < 3 then
    raise exception 'NOT_ENOUGH_SSR_COPIES' using errcode = 'P0001';
  end if;

  delete from public.user_cards where id = any(consumed_ids);
  insert into public.user_cards (user_id, card_id, date_obtention, rarity, is_shiny, is_evolved)
    values (player_id, target_card.id, evolved_at, 'SSR', true, true)
    returning id into evolved_id;
  return jsonb_build_object(
    'id', target_card.id, 'name', target_card.nom, 'category', target_card.categorie,
    'rarity', 'SSR', 'image', target_card.image_url, 'instanceId', evolved_id,
    'obtainedAt', evolved_at, 'shiny', true, 'isEvolved', true
  );
end;
$$;

revoke all on function public.evolve_ssr_card(uuid) from public, anon, authenticated;
grant execute on function public.evolve_ssr_card(uuid) to authenticated;

commit;
