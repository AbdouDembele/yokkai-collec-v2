begin;

-- Product-approved rebalance: Regular SR 7% -> 10%, funded by Common.
-- Every directly drawn LR has a 10% Shiny chance, in either pack type.
-- Existing cards and pending Decision choices keep their original results.

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
    'dropRates', '[{"rarity":"C","percent":69.4},{"rarity":"R","percent":20},{"rarity":"SR","percent":10},{"rarity":"SSR","percent":0.5},{"rarity":"LR","percent":0.1}]'::jsonb,
    'decisionDropRates', public.decision_pack_drop_rates(),
    'shinyRate', 10
  );
end;
$$;

create or replace function public.open_regular_pack()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid:=auth.uid(); deadline timestamptz; server_now timestamptz;
  step integer; bonus integer; reserve_maximum integer;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[]:=array['C','R','SR','SSR','LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; copy_ids uuid[]:='{}'; card_ids uuid[]:='{}'; shinies boolean[]:='{}';
  result jsonb:='[]'::jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player_id);
  select next_regular_pack_at,regular_pack_interval_seconds,bonus_regular_packs
    into deadline,step,bonus
    from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  reserve_maximum:=case when public.billing_has_game_pro(player_id) then 10 else 5 end;
  server_now:=clock_timestamp();
  if bonus=0 and deadline>server_now then raise exception 'PACK_NOT_READY'; end if;
  select array[count(*) filter(where rarete_base='C'),count(*) filter(where rarete_base='R'),
    count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE'; end if;
  for position in 1..5 loop
    roll:=random();
    rarity_index:=case when roll<.694 then 1 when roll<.894 then 2 when roll<.994 then 3 when roll<.999 then 4 else 5 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.1;
    copy_id:=gen_random_uuid();
    copy_ids:=array_append(copy_ids,copy_id); card_ids:=array_append(card_ids,selected_card.id); shinies:=array_append(shinies,shiny);
    result:=result||jsonb_build_array(jsonb_build_object(
      'id',selected_card.id,'name',selected_card.nom,'category',selected_card.categorie,
      'liveFranchise',true,'anime',selected_card.franchise,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
      'catalogueImage',selected_card.image_url,'customImageUrl',null,
      'instanceId',copy_id,'obtainedAt',server_now,'shiny',shiny,'isEvolved',false,
      'isFirstOwner',selected_card.rarete_base='LR','folderId',null));
  end loop;
  insert into public.user_cards(id,user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    select drawn.id,player_id,drawn.card_id,server_now,c.rarete_base,drawn.shiny,false,c.rarete_base='LR'
    from unnest(copy_ids,card_ids,shinies) as drawn(id,card_id,shiny) join public.cards c on c.id=drawn.card_id;
  update public.user_profiles set
    bonus_regular_packs=case when bonus>0 then bonus-1 else 0 end,
    next_regular_pack_at=case when bonus>0 then deadline
      else greatest(deadline,server_now-make_interval(secs=>(reserve_maximum-1)*step))+make_interval(secs=>step) end
    where user_id=player_id;
  perform public.ensure_achievement_stats(player_id);
  update public.user_achievement_stats set regular_packs_opened=regular_packs_opened+1 where user_id=player_id;
  perform public.complete_achievements(player_id,array['regular_packs_opened']);
  return result;
end;
$$;

create or replace function public.open_decision_pack()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid:=auth.uid(); server_now timestamptz;
  window_start timestamptz; reset_at timestamptz; quota integer; used bigint;
  pending_id uuid; pack_id uuid; pool_sizes bigint[];
  rarities public.card_rarity[]:=array['SR','SSR','LR']::public.card_rarity[];
  rates jsonb:=public.decision_pack_drop_rates();
  rarity_index integer; selected_card public.cards%rowtype; shiny boolean; roll double precision;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player_id);
  perform 1 from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  select id into pending_id from public.decision_packs where user_id=player_id and status='pending' for update;
  -- Resuming a choice (even from a previous day) never spends another pack.
  if pending_id is not null then return public.decision_pack_cards(pending_id); end if;
  server_now:=clock_timestamp();
  select period_start,next_reset_at into window_start,reset_at from public.decision_pack_daily_window(server_now);
  quota:=case when public.billing_has_game_pro(player_id) then 2 else 1 end;
  select count(*) into used from public.decision_packs
    where user_id=player_id and created_at>=window_start and created_at<reset_at;
  if used>=quota then raise exception 'DECISION_PACK_NOT_READY'; end if;
  select array[count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),count(*) filter(where rarete_base='LR')]
    into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE'; end if;
  insert into public.decision_packs(user_id,created_at) values(player_id,server_now) returning id into pack_id;
  for position in 1..5 loop
    roll:=random(); rarity_index:=case when roll<(rates->0->>'percent')::double precision/100 then 1 when roll<((rates->0->>'percent')::double precision+(rates->1->>'percent')::double precision)/100 then 2 else 3 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.1;
    insert into public.decision_pack_choices(pack_id,card_id,rarity,is_shiny,position)
      values(pack_id,selected_card.id,selected_card.rarete_base,shiny,position);
  end loop;
  update public.user_profiles set next_decision_pack_at=reset_at where user_id=player_id;
  return public.decision_pack_cards(pack_id);
end;
$$;

commit;
