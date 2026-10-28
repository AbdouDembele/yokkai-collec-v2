begin;

-- The timed reserve remains capped independently from referral bonus packs.
-- Verified Pro members may bank ten timed packs; everyone else may bank five.
create or replace function public.get_regular_pack_status()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player uuid:=auth.uid(); deadline timestamptz; stamp timestamptz;
  step integer; reserve_available integer; reserve_maximum integer; bonus integer;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player);
  select next_regular_pack_at,regular_pack_interval_seconds,bonus_regular_packs
    into deadline,step,bonus
    from public.user_profiles where user_id=player;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  reserve_maximum:=case when public.billing_has_game_pro(player) then 10 else 5 end;
  stamp:=clock_timestamp();
  reserve_available:=least(reserve_maximum,greatest(0,1+floor(extract(epoch from(stamp-deadline))/step)))::integer;
  return jsonb_build_object(
    'available',reserve_available+bonus,
    'maximum',reserve_maximum,
    'reserve',reserve_available,
    'bonus',bonus,
    'nextPackAt',case when reserve_available=reserve_maximum then null else extract(epoch from(deadline+make_interval(secs=>reserve_available*step)))*1000 end,
    'serverNow',extract(epoch from stamp)*1000,
    'refillSeconds',step
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
    rarity_index:=case when roll<.724 then 1 when roll<.924 then 2 when roll<.994 then 3 when roll<.999 then 4 else 5 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.001;
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

revoke all on function public.get_regular_pack_status(), public.open_regular_pack()
  from public, anon;
grant execute on function public.get_regular_pack_status(), public.open_regular_pack()
  to authenticated;

commit;
