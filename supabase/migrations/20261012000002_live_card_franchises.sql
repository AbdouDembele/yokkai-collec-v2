begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';

-- Mark only card objects joined to the live catalogue. Historical snapshots
-- deliberately keep the old fallback, including before this migration is applied.

CREATE OR REPLACE FUNCTION public.decision_pack_cards(p_pack_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',cards.id,'name',cards.nom,'category',cards.categorie,'liveFranchise',true,'anime',cards.franchise,
    'rarity',choices.rarity,'image',cards.image_url,'instanceId',choices.id,'obtainedAt',packs.created_at,
    'shiny',choices.is_shiny,'isEvolved',false,'discarded',choices.is_discarded,
    'destructionValue',public.card_destruction_value(choices.rarity)
  ) order by choices.rarity,choices.position),'[]'::jsonb)
  from public.decision_pack_choices choices
  join public.decision_packs packs on packs.id=choices.pack_id
  join public.cards cards on cards.id=choices.card_id
  where choices.pack_id=p_pack_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_auction(p_auction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare player_id uuid := auth.uid(); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select jsonb_build_object('id',a.id,'card',case when c.id is not null then jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,
    'liveFranchise',true,'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url,'catalogueImage',c.image_url,'shiny',uc.is_shiny) else a.card_snapshot end,
    'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',coalesce(p.pseudo,'Joueur supprimé'),'sellerId',a.seller_id,
    'sellerAvatarUrl',p.avatar_url,'buyerId',a.buyer_id,'bids',(select count(*) from public.bids b where b.auction_id=a.id),
    'winner',case when a.status='sold' then coalesce((select pseudo from public.user_profiles where user_id=a.buyer_id),'Joueur supprimé') else (select pseudo from public.user_profiles where user_id=a.buyer_id) end,
    'balance',(select karas_balance from public.user_profiles where user_id=player_id),
    'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',coalesce(bp.pseudo,'Joueur supprimé'),'avatarUrl',bp.avatar_url,
      'amount',b.amount,'createdAt',b.created_at,'mine',b.bidder_id=player_id) order by b.created_at desc),'[]'::jsonb)
      from public.bids b left join public.user_profiles bp on bp.user_id=b.bidder_id where b.auction_id=a.id)) into result
    from public.auctions a left join public.user_cards uc on uc.id=a.card_instance_id left join public.cards c on c.id=uc.card_id
    left join public.user_profiles p on p.user_id=a.seller_id where a.id=p_auction_id and (c.id is not null or a.card_snapshot is not null);
  if result is null then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_card_discovery(p_card_id uuid, p_owner_offset integer DEFAULT 0, p_owner_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare player_id uuid:=auth.uid(); result jsonb; safe_limit integer:=least(greatest(coalesce(p_owner_limit,12),1),30); safe_offset integer:=greatest(coalesce(p_owner_offset,0),0);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select jsonb_build_object(
    'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'liveFranchise',true,'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url),
    'marketValue',(select avg(a.current_price)::numeric(12,2) from public.auctions a join public.user_cards sold_uc on sold_uc.id=a.card_instance_id where a.status='sold' and sold_uc.card_id=c.id),
    'activeAuctionId',(select a.id from public.auctions a join public.user_cards auc_uc on auc_uc.id=a.card_instance_id where a.status='active' and auc_uc.card_id=c.id order by a.ends_at limit 1),
    'wishlisted',exists(select 1 from public.wishlists w where w.user_id=player_id and w.card_id=c.id),
    'ownerCount',(select count(distinct uc.user_id) from public.user_cards uc where uc.card_id=c.id and public.can_view_collection(player_id,uc.user_id)),
    'owners',coalesce((select jsonb_agg(jsonb_build_object('id',o.user_id,'pseudo',o.pseudo,'copies',o.copies,'isFriend',o.is_friend) order by o.is_friend desc,o.pseudo,o.user_id)
      from (select uc.user_id,p.pseudo,count(*) copies,public.friendship_state(player_id,uc.user_id)='accepted' is_friend
        from public.user_cards uc join public.user_profiles p on p.user_id=uc.user_id
        where uc.card_id=c.id and public.can_view_collection(player_id,uc.user_id)
        group by uc.user_id,p.pseudo order by is_friend desc,p.pseudo,uc.user_id offset safe_offset limit safe_limit) o),'[]'::jsonb)
  ) into result from public.cards c where c.id=p_card_id;
  if result is null then raise exception 'CARD_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_profile(p_identifier text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare viewer uuid:=auth.uid(); target public.user_profiles%rowtype; result jsonb; allowed boolean; friends_allowed boolean;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_identifier is null or btrim(p_identifier)='' then
    select * into target from public.user_profiles where user_id=viewer;
  else
    select * into target from public.user_profiles where lower(pseudo)=lower(btrim(p_identifier))
      or user_id=case when p_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_identifier::uuid else null end limit 1;
  end if;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  allowed:=public.can_view_collection(viewer,target.user_id);
  friends_allowed:=viewer=target.user_id or target.is_public;
  select jsonb_build_object(
    'id',target.user_id,'pseudo',target.pseudo,'avatarUrl',target.avatar_url,'bio',target.bio,
    'isPublic',target.is_public,'canViewCollection',allowed,
    'bannerCard',(select jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'liveFranchise',true,'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url) from public.cards c where c.id=target.banner_card_id),
    'friendshipStatus',case when target.user_id=viewer then 'self' else public.friendship_state(viewer,target.user_id) end,
    'featuredCards',case when allowed then coalesce((select jsonb_agg(public.profile_card_json(c,uc) order by pos)
      from unnest(target.featured_card_ids) with ordinality picked(instance_id,pos)
      join public.user_cards uc on uc.id=picked.instance_id and uc.user_id=target.user_id
      join public.cards c on c.id=uc.card_id),'[]'::jsonb) else '[]'::jsonb end,
    'friendsVisible',friends_allowed,
    'friends',case when friends_allowed then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url) order by lower(p.pseudo))
      from public.friendships f join public.user_profiles p on p.user_id=case when f.user_id=target.user_id then f.friend_id else f.user_id end
      where f.status='accepted' and (f.user_id=target.user_id or f.friend_id=target.user_id)),'[]'::jsonb) else '[]'::jsonb end,
    'cardCount',case when allowed then (select count(*) from public.user_cards where user_id=target.user_id) else null end,
    'distinctCardCount',case when allowed then (select count(distinct card_id) from public.user_cards where user_id=target.user_id) else null end
  ) into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.keep_decision_pack_card(p_choice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare player_id uuid:=auth.uid();choice record;copy_id uuid;kept_at timestamptz:=clock_timestamp();reward integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select choices.*,cards.nom,cards.categorie,cards.franchise,cards.image_url into choice
    from public.decision_pack_choices choices
    join public.decision_packs packs on packs.id=choices.pack_id
    join public.cards cards on cards.id=choices.card_id
    where choices.id=p_choice_id and packs.user_id=player_id and packs.status='pending'
    for update of packs,choices;
  if not found or choice.is_discarded then raise exception 'DECISION_CHOICE_UNAVAILABLE' using errcode='P0001'; end if;
  select coalesce(sum(public.card_destruction_value(other_choices.rarity)),0)::integer into reward
    from public.decision_pack_choices other_choices
    where other_choices.pack_id=choice.pack_id and other_choices.id<>choice.id and not other_choices.is_discarded;
  insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    values(player_id,choice.card_id,kept_at,choice.rarity,choice.is_shiny,false,choice.rarity='LR') returning id into copy_id;
  update public.decision_pack_choices set is_discarded=true where pack_id=choice.pack_id and id<>choice.id and not is_discarded;
  update public.decision_packs set status='claimed',claimed_at=kept_at,kept_choice_id=choice.id where id=choice.pack_id;
  if reward <> 0 then
    perform public.credit_karas(player_id,reward);
  end if;
  return jsonb_build_object('id',choice.card_id,'name',choice.nom,'category',choice.categorie,'liveFranchise',true,'anime',choice.franchise,
    'rarity',choice.rarity,'image',choice.image_url,'catalogueImage',choice.image_url,'customImageUrl',null,
    'instanceId',copy_id,'obtainedAt',kept_at,'shiny',choice.is_shiny,'isEvolved',false,
    'isFirstOwner',choice.rarity='LR','folderId',null,'karasReward',reward);
end; $function$
;

CREATE OR REPLACE FUNCTION public.list_auctions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare player_id uuid := auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (with player_bids as materialized (select distinct b.auction_id from public.bids b where b.bidder_id=player_id)
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'card',case when c.id is not null then jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'liveFranchise',true,'anime',c.franchise,
        'rarity',c.rarete_base,'image',c.image_url,'catalogueImage',c.image_url,'shiny',uc.is_shiny) else a.card_snapshot end,
      'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',coalesce(p.pseudo,'Joueur supprimé'),'sellerId',a.seller_id,
      'sellerAvatarUrl',p.avatar_url,'buyerId',a.buyer_id,'hasBid',pb.auction_id is not null,
      'popularity',coalesce(c.favoris_count,0),'bids',(select count(*) from public.bids b where b.auction_id=a.id),
      'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
    ) order by a.ends_at),'[]'::jsonb)
    from public.auctions a left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id left join public.user_profiles p on p.user_id=a.seller_id
    left join player_bids pb on pb.auction_id=a.id
    where (c.id is not null or a.card_snapshot is not null) and (a.status='active' or a.seller_id=player_id or a.buyer_id=player_id or pb.auction_id is not null));
end; $function$
;

CREATE OR REPLACE FUNCTION public.list_auctions_page(p_cursor jsonb DEFAULT NULL::jsonb, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare player_id uuid:=auth.uid(); page_size integer:=least(p_limit,100);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_limit is null or p_limit<1 then raise exception 'INVALID_PAGE_SIZE' using errcode='P0001'; end if;
  return (with player_bids as materialized (select distinct b.auction_id from public.bids b where b.bidder_id=player_id),
  selected as materialized (
    select a.*,uc.is_shiny,c.id card_id,c.nom,c.categorie,c.franchise,c.rarete_base,c.image_url,c.favoris_count,
      p.pseudo,p.avatar_url,pb.auction_id is not null has_bid
    from public.auctions a left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id left join public.user_profiles p on p.user_id=a.seller_id
    left join player_bids pb on pb.auction_id=a.id
    where (c.id is not null or a.card_snapshot is not null) and (a.status='active' or a.seller_id=player_id or a.buyer_id=player_id or pb.auction_id is not null)
      and (p_cursor is null or (a.created_at,a.id)>((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
    -- Immutable cursor: anti-sniping changes ends_at, never created_at.
    order by a.created_at,a.id limit page_size
  ) select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'card',case when a.card_id is not null then jsonb_build_object('id',a.card_id,'name',a.nom,'category',a.categorie,'liveFranchise',true,'anime',a.franchise,
        'rarity',a.rarete_base,'image',a.image_url,'catalogueImage',a.image_url,'shiny',a.is_shiny) else a.card_snapshot end,
      'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',coalesce(a.pseudo,'Joueur supprimé'),'sellerId',a.seller_id,
      'sellerAvatarUrl',a.avatar_url,'buyerId',a.buyer_id,'hasBid',a.has_bid,'popularity',coalesce(a.favoris_count,0),
      'bids',(select count(*) from public.bids b where b.auction_id=a.id),
      'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
    ) order by a.created_at,a.id),'[]'::jsonb),
    'nextCursor',case when count(*)=page_size then
      jsonb_agg(jsonb_build_object('createdAt',a.created_at,'id',a.id) order by a.created_at desc,a.id desc)->0 end
  ) from selected a);
end; $function$
;

CREATE OR REPLACE FUNCTION public.list_wishlist(p_identifier text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare viewer uuid:=auth.uid(); target_id uuid;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_identifier is null or btrim(p_identifier)='' then target_id:=viewer;
  else select user_id into target_id from public.user_profiles where lower(pseudo)=lower(btrim(p_identifier)) or user_id=case when p_identifier~*'^[0-9a-f-]{36}$' then p_identifier::uuid else null end limit 1;
  end if;
  if target_id is null then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'liveFranchise',true,'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url,'createdAt',w.created_at) order by w.created_at desc),'[]'::jsonb)
    from public.wishlists w join public.cards c on c.id=w.card_id where w.user_id=target_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.open_regular_pack()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'liveFranchise',true,'anime',selected_card.franchise,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
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
$function$
;

CREATE OR REPLACE FUNCTION public.profile_card_json(c cards, uc user_cards)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'liveFranchise',true,'anime',c.franchise,
    'rarity',c.rarete_base,'image',coalesce(uc.custom_image_url,c.image_url),'catalogueImage',c.image_url,
    'customImageUrl',uc.custom_image_url,'instanceId',uc.id,'obtainedAt',uc.date_obtention,
    'shiny',uc.is_shiny,'isEvolved',uc.is_evolved,'isFirstOwner',uc.is_first_owner,'folderId',uc.folder_id)
$function$
;

CREATE OR REPLACE FUNCTION public.trade_card_json(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'instanceId',uc.id,'id',c.id,'name',c.nom,'category',c.categorie,'liveFranchise',true,'anime',c.franchise,
    'rarity',c.rarete_base,'image',c.image_url,'catalogueImage',c.image_url,'customImageUrl',uc.custom_image_url,
    'shiny',uc.is_shiny,'isEvolved',uc.is_evolved,'isFirstOwner',uc.is_first_owner,
    'obtainedAt',uc.date_obtention,'folderId',uc.folder_id
  ) order by array_position(p_ids,uc.id)),'[]'::jsonb)
  from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.id=any(p_ids)
$function$
;

commit;
