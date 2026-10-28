begin;

drop function if exists public.evolve_ssr_card(uuid);

create function public.evolve_ssr_card(p_card_instance_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  target_card public.cards%rowtype;
  selected_count integer;
  evolved_id uuid;
  evolved_at timestamptz := clock_timestamp();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if cardinality(p_card_instance_ids) <> 3
    or (select count(distinct id) from unnest(p_card_instance_ids) as ids(id)) <> 3 then
    raise exception 'THREE_DISTINCT_SSR_COPIES_REQUIRED' using errcode = 'P0001';
  end if;

  select cards.* into target_card
    from public.user_cards owned
    join public.cards cards on cards.id = owned.card_id
    where owned.id = p_card_instance_ids[1] and owned.user_id = player_id
      and cards.rarete_base = 'SSR' and owned.rarity = 'SSR' and not owned.is_shiny
    for update of owned;
  if not found then raise exception 'SSR_CARD_NOT_OWNED' using errcode = 'P0001'; end if;

  select count(*) into selected_count from (
    select owned.id from public.user_cards owned
      where owned.id = any(p_card_instance_ids)
        and owned.user_id = player_id
        and owned.card_id = target_card.id
        and owned.rarity = 'SSR'
        and not owned.is_shiny
      for update
  ) selected;
  if selected_count <> 3 then
    raise exception 'INVALID_SSR_COPIES' using errcode = 'P0001';
  end if;

  delete from public.user_cards
    where user_id = player_id and id = any(p_card_instance_ids);
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

revoke all on function public.evolve_ssr_card(uuid[]) from public, anon;
grant execute on function public.evolve_ssr_card(uuid[]) to authenticated;

commit;
