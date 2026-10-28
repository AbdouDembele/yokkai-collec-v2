-- One collection-achievement evaluation per inserted batch; ownership UPDATE
-- and DELETE behavior are unchanged. All FK indexes are on small production
-- tables (8-80 KiB at preparation); abort promptly if players hold a lock.
begin;
set local lock_timeout = '3s';

create or replace function public.on_cards_inserted_achievements()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare player record;
begin
  for player in
    select user_id, count(*) filter(where is_evolved)::integer as evolved,
      bool_or(not is_evolved) as acquired
    from inserted_cards group by user_id order by user_id
  loop
    perform public.ensure_achievement_stats(player.user_id);
    if player.evolved > 0 then
      update public.user_achievement_stats
        set ssr_evolved_to_lr=ssr_evolved_to_lr+player.evolved where user_id=player.user_id;
      perform public.complete_achievements(player.user_id,array['ssr_evolved_to_lr']);
    end if;
    if player.acquired then
      perform public.complete_achievements(player.user_id,array[
        'unique_cards_collected','first_lr_card','shiny_cards_collected','cards_collected_category_percent'
      ]);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.on_cards_inserted_achievements() from public, anon, authenticated;

drop trigger if exists user_cards_acquired_achievements on public.user_cards;
create trigger user_cards_acquired_achievements after update of user_id on public.user_cards
  for each row execute function public.on_card_acquired_achievements();
drop trigger if exists user_cards_inserted_achievements on public.user_cards;
create trigger user_cards_inserted_achievements after insert on public.user_cards
  referencing new table as inserted_cards
  for each statement execute function public.on_cards_inserted_achievements();

create index if not exists trade_offers_to_user_idx on public.trade_offers(to_user);
create index if not exists auctions_seller_id_idx on public.auctions(seller_id);
create index if not exists auctions_buyer_id_idx on public.auctions(buyer_id);
create index if not exists wishlists_card_id_idx on public.wishlists(card_id);
create index if not exists notifications_actor_user_id_idx on public.notifications(actor_user_id);
create index if not exists auction_watchers_auction_id_idx on public.auction_watchers(auction_id);
create index if not exists user_reports_reported_id_idx on public.user_reports(reported_id);

create or replace function public.open_regular_pack()
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid(); deadline timestamptz; server_now timestamptz;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[] := array['C','R','SR','SSR','LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; copy_ids uuid[] := '{}'; card_ids uuid[] := '{}'; shinies boolean[] := '{}';
  result jsonb := '[]'::jsonb;
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
    copy_id := gen_random_uuid();
    copy_ids := array_append(copy_ids,copy_id);
    card_ids := array_append(card_ids,selected_card.id);
    shinies := array_append(shinies,shiny);
    result := result || jsonb_build_array(jsonb_build_object(
      'id',selected_card.id,'name',selected_card.nom,'category',selected_card.categorie,
      'anime',selected_card.franchise,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
      'catalogueImage',selected_card.image_url,'customImageUrl',null,
      'instanceId',copy_id,'obtainedAt',server_now,'shiny',shiny,'isEvolved',false,
      'isFirstOwner',selected_card.rarete_base='LR','folderId',null));
  end loop;
  insert into public.user_cards(id,user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    select drawn.id,player_id,drawn.card_id,server_now,c.rarete_base,drawn.shiny,false,c.rarete_base='LR'
    from unnest(copy_ids,card_ids,shinies) as drawn(id,card_id,shiny)
    join public.cards c on c.id=drawn.card_id;
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
