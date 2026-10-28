begin;

-- Convert cards created by the former SSR -> LR rule before tightening the invariant.
alter table public.user_cards drop constraint if exists user_cards_evolved_lr_check;
alter table public.user_cards drop constraint if exists user_cards_evolved_shiny_ssr_check;
update public.user_cards
set rarity = 'SSR', is_shiny = true, is_first_owner = false
where is_evolved;
alter table public.user_cards
  add constraint user_cards_evolved_shiny_ssr_check
  check (not is_evolved or (rarity = 'SSR' and is_shiny));

update public.achievements
set description = 'Faire évoluer une première carte SSR en Shiny.'
where id = 'transcendance';

create or replace function public.evolve_ssr_card(p_card_instance_id uuid)
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
  insert into public.user_cards
    (user_id, card_id, date_obtention, rarity, is_shiny, is_evolved, is_first_owner)
    values (player_id, target_card.id, evolved_at, 'SSR', true, true, false)
    returning id into evolved_id;
  return jsonb_build_object(
    'id', target_card.id, 'name', target_card.nom, 'category', target_card.categorie,
    'rarity', target_card.rarete_base, 'image', target_card.image_url, 'catalogueImage', target_card.image_url,
    'customImageUrl', null, 'instanceId', evolved_id, 'obtainedAt', evolved_at,
    'shiny', true, 'isEvolved', true, 'isFirstOwner', false, 'folderId', null
  );
end;
$$;

create or replace function public.open_decision_pack()
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
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
    roll:=random(); rarity_index:=case when roll<.94 then 1 when roll<.99 then 2 else 3 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.05;
    insert into public.decision_pack_choices(pack_id,card_id,rarity,is_shiny,position)
      values(pack_id,selected_card.id,selected_card.rarete_base,shiny,position);
  end loop;
  update public.user_profiles set next_decision_pack_at=server_now+interval '1 day' where user_id=player_id;
  return public.decision_pack_cards(pack_id);
end;
$$;

create or replace function public.open_regular_pack()
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
  player_id uuid:=auth.uid(); deadline timestamptz; server_now timestamptz;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[]:=array['C','R','SR','SSR','LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; result jsonb:='[]'::jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select next_regular_pack_at into deadline from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;
  server_now:=clock_timestamp();
  if deadline>server_now then raise exception 'PACK_NOT_READY' using errcode='P0001'; end if;
  select array[count(*) filter(where rarete_base='C'),count(*) filter(where rarete_base='R'),
    count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE' using errcode='P0001'; end if;
  for position in 1..5 loop
    roll:=random();
    rarity_index:=case when roll<.59 then 1 when roll<.84 then 2 when roll<.94 then 3 when roll<.99 then 4 else 5 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.05;
    insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
      values(player_id,selected_card.id,server_now,selected_card.rarete_base,shiny,false,selected_card.rarete_base='LR')
      returning id into copy_id;
    result:=result||jsonb_build_array(jsonb_build_object('id',selected_card.id,'name',selected_card.nom,
      'category',selected_card.categorie,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
      'instanceId',copy_id,'obtainedAt',server_now,'shiny',shiny,'isEvolved',false,
      'isFirstOwner',selected_card.rarete_base='LR','folderId',null));
  end loop;
  update public.user_profiles set next_regular_pack_at=greatest(deadline,server_now-interval '60 minutes')+interval '15 minutes'
    where user_id=player_id;
  perform public.ensure_achievement_stats(player_id);
  update public.user_achievement_stats set regular_packs_opened=regular_packs_opened+1 where user_id=player_id;
  perform public.complete_achievements(player_id,array['regular_packs_opened']);
  return result;
end;
$$;

commit;
