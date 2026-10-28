begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Inherit only from the five consumed copies. The first custom-art copy in
-- the validated input order supplies the result's image, matching the preview.
create or replace function public.evolve_lr_card(p_card_instance_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  player_id uuid := auth.uid(); target_card public.cards%rowtype;
  selected_count integer; evolved_id uuid; evolved_at timestamptz := clock_timestamp(); inherited_image text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_card_instance_ids is null or cardinality(p_card_instance_ids) <> 5
    or array_ndims(p_card_instance_ids) <> 1 or array_lower(p_card_instance_ids,1) <> 1
    or (select count(distinct id) from unnest(p_card_instance_ids) as ids(id)) <> 5 then
    raise exception 'FIVE_DISTINCT_LR_COPIES_REQUIRED' using errcode='P0001';
  end if;
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
  select owned.custom_image_url into inherited_image from public.user_cards owned
    where owned.user_id=player_id and owned.id=any(p_card_instance_ids) and owned.custom_image_url is not null
    order by array_position(p_card_instance_ids,owned.id) limit 1;
  delete from public.user_cards where user_id=player_id and id=any(p_card_instance_ids);
  insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner,custom_image_url)
    values(player_id,target_card.id,evolved_at,'LR',false,true,false,inherited_image) returning id into evolved_id;
  return jsonb_build_object('id',target_card.id,'name',target_card.nom,'category',target_card.categorie,
    'anime',target_card.franchise,'rarity','LR','image',coalesce(inherited_image,target_card.image_url),'catalogueImage',target_card.image_url,
    'customImageUrl',inherited_image,'instanceId',evolved_id,'obtainedAt',evolved_at,'shiny',false,
    'isEvolved',true,'isFirstOwner',false,'locked',false,'folderId',null);
end; $$;

create or replace function public.evolve_ssr_card(p_card_instance_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  player_id uuid := auth.uid(); target_card public.cards%rowtype; selected_count integer;
  evolved_id uuid; evolved_at timestamptz := clock_timestamp(); inherited_image text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if cardinality(p_card_instance_ids) <> 5
    or (select count(distinct id) from unnest(p_card_instance_ids) as ids(id)) <> 5 then
    raise exception 'FIVE_DISTINCT_SSR_COPIES_REQUIRED' using errcode = 'P0001';
  end if;
  select cards.* into target_card from public.user_cards owned join public.cards cards on cards.id=owned.card_id
    where owned.id=p_card_instance_ids[1] and owned.user_id=player_id and cards.rarete_base='SSR'
      and owned.rarity='SSR' and not owned.is_shiny for update of owned;
  if not found then raise exception 'SSR_CARD_NOT_OWNED' using errcode = 'P0001'; end if;
  select count(*) into selected_count from (
    select owned.id from public.user_cards owned where owned.id=any(p_card_instance_ids)
      and owned.user_id=player_id and owned.card_id=target_card.id and owned.rarity='SSR' and not owned.is_shiny
      for update
  ) selected;
  if selected_count <> 5 then raise exception 'INVALID_SSR_COPIES' using errcode = 'P0001'; end if;
  select owned.custom_image_url into inherited_image from public.user_cards owned
    where owned.user_id=player_id and owned.id=any(p_card_instance_ids) and owned.custom_image_url is not null
    order by array_position(p_card_instance_ids,owned.id) limit 1;
  delete from public.user_cards where user_id=player_id and id=any(p_card_instance_ids);
  insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner,custom_image_url)
    values(player_id,target_card.id,evolved_at,'SSR',true,true,false,inherited_image) returning id into evolved_id;
  return jsonb_build_object('id',target_card.id,'name',target_card.nom,'category',target_card.categorie,
    'rarity',target_card.rarete_base,'image',coalesce(inherited_image,target_card.image_url),'catalogueImage',target_card.image_url,
    'customImageUrl',inherited_image,'instanceId',evolved_id,'obtainedAt',evolved_at,'shiny',true,
    'isEvolved',true,'isFirstOwner',false,'folderId',null);
end; $$;

revoke all on function public.evolve_ssr_card(uuid[]),public.evolve_lr_card(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.evolve_ssr_card(uuid[]),public.evolve_lr_card(uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
