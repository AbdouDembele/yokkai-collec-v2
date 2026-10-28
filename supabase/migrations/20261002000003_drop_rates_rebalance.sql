-- Rebalance pack drop rates (2026-10-02).
-- Regular: C 71.9% / R 20% / SR 7% / SSR 1% / LR 0.1%.
-- Decision: SR 97.8% / SSR 2% / LR 0.2%; C and R are absent from its pool.
-- Shiny: independent 0.1% chance on direct LR draws only; direct SSR stays non-Shiny.

begin;

create or replace function public.get_game_info()
returns jsonb language plpgsql stable security invoker set search_path = ''
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
    'dropRates', '[{"rarity":"C","percent":71.9},{"rarity":"R","percent":20},{"rarity":"SR","percent":7},{"rarity":"SSR","percent":1},{"rarity":"LR","percent":0.1}]'::jsonb,
    'shinyRate', 0.1
  );
end;
$$;

create or replace function public.open_regular_pack()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    rarity_index := case when roll<.719 then 1 when roll<.919 then 2 when roll<.989 then 3 when roll<.999 then 4 else 5 end;
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
  update public.user_profiles set next_regular_pack_at = greatest(deadline,server_now-interval '60 minutes')+interval '15 minutes'
    where user_id = player_id;
  perform public.ensure_achievement_stats(player_id);
  update public.user_achievement_stats set regular_packs_opened = regular_packs_opened + 1 where user_id = player_id;
  perform public.complete_achievements(player_id,array['regular_packs_opened']);
  return result;
end;
$function$;

create or replace function public.open_decision_pack()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  player_id uuid := auth.uid(); deadline timestamptz; server_now timestamptz;
  pending_id uuid; pack_id uuid; pool_sizes bigint[];
  rarities public.card_rarity[] := array['SR', 'SSR', 'LR']::public.card_rarity[];
  rarity_index integer; selected_card public.cards%rowtype; shiny boolean; roll double precision;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select next_decision_pack_at into deadline from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  select id into pending_id from public.decision_packs where user_id=player_id and status='pending' for update;
  if pending_id is not null then return public.decision_pack_cards(pending_id); end if;
  server_now := clock_timestamp();
  if deadline > server_now then raise exception 'DECISION_PACK_NOT_READY' using errcode = 'P0001'; end if;
  select array[count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE' using errcode = 'P0001'; end if;
  insert into public.decision_packs(user_id,created_at) values(player_id,server_now) returning id into pack_id;
  for position in 1..5 loop
    roll:=random(); rarity_index:=case when roll<.978 then 1 when roll<.998 then 2 else 3 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.001;
    insert into public.decision_pack_choices(pack_id,card_id,rarity,is_shiny,position)
      values(pack_id,selected_card.id,selected_card.rarete_base,shiny,position);
  end loop;
  update public.user_profiles set next_decision_pack_at=server_now+interval '1 day' where user_id=player_id;
  return public.decision_pack_cards(pack_id);
end;
$function$;

commit;
