begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- SSR keeps its historical storage flag. LR Evolved is explicitly non-Shiny.
alter table public.user_cards drop constraint user_cards_evolved_shiny_ssr_check;
alter table public.user_cards add constraint user_cards_evolved_variant_check
  check (not is_evolved or (rarity='SSR' and is_shiny) or (rarity='LR' and not is_shiny));

create function public.evolve_lr_card(p_card_instance_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  player_id uuid := auth.uid(); target_card public.cards%rowtype;
  selected_count integer; evolved_id uuid; evolved_at timestamptz := clock_timestamp();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_card_instance_ids is null or cardinality(p_card_instance_ids) <> 5
    or array_ndims(p_card_instance_ids) <> 1 or array_lower(p_card_instance_ids,1) <> 1
    or (select count(distinct id) from unnest(p_card_instance_ids) as ids(id)) <> 5 then
    raise exception 'FIVE_DISTINCT_LR_COPIES_REQUIRED' using errcode='P0001';
  end if;
  -- Stable row order serializes overlapping selections; never lock someone else's cards.
  perform owned.id from public.user_cards owned
    where owned.user_id=player_id and owned.id=any(p_card_instance_ids)
    order by owned.id for update;
  select c.* into target_card from public.user_cards owned join public.cards c on c.id=owned.card_id
    where owned.id=p_card_instance_ids[1] and owned.user_id=player_id
      and c.rarete_base='LR' and owned.rarity='LR' and not owned.is_shiny and not owned.is_evolved;
  if not found then raise exception 'INVALID_LR_COPIES' using errcode='P0001'; end if;
  select count(*) into selected_count from public.user_cards owned
    where owned.id=any(p_card_instance_ids) and owned.user_id=player_id
      and owned.card_id=target_card.id and owned.rarity='LR' and not owned.is_shiny and not owned.is_evolved;
  if selected_count <> 5 then raise exception 'INVALID_LR_COPIES' using errcode='P0001'; end if;
  if exists(select 1 from public.user_cards where id=any(p_card_instance_ids) and is_locked) then
    raise exception 'CARD_LOCKED' using errcode='P0001';
  end if;
  if exists(select 1 from public.auctions where card_instance_id=any(p_card_instance_ids) and status='active') then
    raise exception 'CARD_FROZEN' using errcode='P0001';
  end if;
  -- Existing deletion/achievement/account guards remain active for the whole transaction.
  delete from public.user_cards where user_id=player_id and id=any(p_card_instance_ids);
  insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    values(player_id,target_card.id,evolved_at,'LR',false,true,false) returning id into evolved_id;
  return jsonb_build_object('id',target_card.id,'name',target_card.nom,'category',target_card.categorie,
    'anime',target_card.franchise,'rarity','LR','image',target_card.image_url,'catalogueImage',target_card.image_url,
    'customImageUrl',null,'instanceId',evolved_id,'obtainedAt',evolved_at,'shiny',false,
    'isEvolved',true,'isFirstOwner',false,'locked',false,'folderId',null);
end; $$;
revoke all on function public.evolve_lr_card(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.evolve_lr_card(uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
