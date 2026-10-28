begin;

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
    rarity_index := case when roll<.59 then 1 when roll<.84 then 2 when roll<.94 then 3 when roll<.99 then 4 else 5 end;
    select * into selected_card from public.cards where rarete_base = rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny := selected_card.rarete_base = 'LR' and random() < .05;
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
$$;

grant execute on function public.open_regular_pack() to authenticated;

commit;
