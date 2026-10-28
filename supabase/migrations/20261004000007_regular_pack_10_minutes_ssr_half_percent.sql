-- Recharge Regular Packs every 10 minutes and lower direct SSR drops to 0.5%.
-- Regular: C 72.4% / R 20% / SR 7% / SSR 0.5% / LR 0.1%.

begin;

alter table public.user_profiles
  alter column next_regular_pack_at set default (now() - interval '40 minutes');
comment on column public.user_profiles.next_regular_pack_at is
  'Availability of the earliest unconsumed Regular Pack. New profiles start with five packs; one regenerates every 10 minutes, capped at five.';

create or replace function public.get_game_info()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  player_name text;
  balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select pseudo, karas_balance into player_name, balance
    from public.user_profiles where user_id = player_id;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'user', jsonb_build_object('id', player_id, 'name', player_name),
    'karasBalance', balance,
    'categories', (select coalesce(jsonb_agg(categorie order by categorie), '[]'::jsonb)
      from (select distinct categorie from public.cards) as categories),
    'rarities', jsonb_build_array('C', 'R', 'SR', 'SSR', 'LR'),
    'dropRates', '[{"rarity":"C","percent":72.4},{"rarity":"R","percent":20},{"rarity":"SR","percent":7},{"rarity":"SSR","percent":0.5},{"rarity":"LR","percent":0.1}]'::jsonb,
    'shinyRate', 0.1
  );
end;
$$;

create or replace function public.get_regular_pack_status()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  deadline timestamptz;
  server_now timestamptz := statement_timestamp();
  available integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select next_regular_pack_at into deadline from public.user_profiles where user_id = player_id;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  available := least(5, greatest(0, 1 + floor(extract(epoch from (server_now - deadline)) / 600)))::integer;
  return jsonb_build_object(
    'available', available, 'maximum', 5,
    'nextPackAt', case when available = 5 then null
      else extract(epoch from (deadline + available * interval '10 minutes')) * 1000 end,
    'serverNow', extract(epoch from server_now) * 1000
  );
end;
$$;

create or replace function public.open_regular_pack()
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid(); deadline timestamptz; server_now timestamptz;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[] := array['C','R','SR','SSR','LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; result jsonb := '[]'::jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select next_regular_pack_at into deadline from public.user_profiles where user_id = player_id for update;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  server_now := clock_timestamp();
  if deadline > server_now then raise exception 'PACK_NOT_READY' using errcode = 'P0001'; end if;
  select array[count(*) filter(where rarete_base='C'), count(*) filter(where rarete_base='R'),
    count(*) filter(where rarete_base='SR'), count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0 = any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE' using errcode = 'P0001'; end if;
  for position in 1..5 loop
    roll := random();
    rarity_index := case when roll<.724 then 1 when roll<.924 then 2 when roll<.994 then 3 when roll<.999 then 4 else 5 end;
    select * into selected_card from public.cards where rarete_base = rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny := selected_card.rarete_base = 'LR' and random() < .001;
    insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
      values(player_id,selected_card.id,server_now,selected_card.rarete_base,shiny,false,selected_card.rarete_base='LR')
      returning id into copy_id;
    result := result || jsonb_build_array(jsonb_build_object(
      'id',selected_card.id,'name',selected_card.nom,'category',selected_card.categorie,
      'anime',selected_card.franchise,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
      'catalogueImage',selected_card.image_url,'customImageUrl',null,
      'instanceId',copy_id,'obtainedAt',server_now,'shiny',shiny,'isEvolved',false,
      'isFirstOwner',selected_card.rarete_base='LR','folderId',null));
  end loop;
  update public.user_profiles
    set next_regular_pack_at = greatest(deadline,server_now-interval '40 minutes')+interval '10 minutes'
    where user_id = player_id;
  perform public.ensure_achievement_stats(player_id);
  update public.user_achievement_stats set regular_packs_opened = regular_packs_opened + 1 where user_id = player_id;
  perform public.complete_achievements(player_id,array['regular_packs_opened']);
  return result;
end;
$$;

commit;
