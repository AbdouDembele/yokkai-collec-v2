begin;

create or replace function public.search_users(p_query text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); query text:=btrim(coalesce(p_query,''));
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if length(query)<2 then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,
    'status',public.friendship_state(player_id,p.user_id)) order by lower(p.pseudo),p.user_id),'[]'::jsonb)
    from (select user_id,pseudo,avatar_url from public.user_profiles
      where user_id<>player_id and pseudo ilike '%'||query||'%' limit 20) p);
end; $$;

create or replace function public.get_friendships()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return jsonb_build_object(
    'friends',(select coalesce(jsonb_agg(jsonb_build_object('id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url) order by lower(p.pseudo)),'[]'::jsonb)
      from public.friendships f join public.user_profiles p on p.user_id=case when f.user_id=player_id then f.friend_id else f.user_id end
      where f.status='accepted' and (f.user_id=player_id or f.friend_id=player_id)),
    'incoming',(select coalesce(jsonb_agg(jsonb_build_object('requestId',f.id,'id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,'createdAt',f.created_at) order by f.created_at),'[]'::jsonb)
      from public.friendships f join public.user_profiles p on p.user_id=f.user_id where f.friend_id=player_id and f.status='pending'),
    'outgoing',(select coalesce(jsonb_agg(jsonb_build_object('requestId',f.id,'id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,'createdAt',f.created_at) order by f.created_at),'[]'::jsonb)
      from public.friendships f join public.user_profiles p on p.user_id=f.friend_id where f.user_id=player_id and f.status='pending'));
end; $$;

create or replace function public.get_trade_context(p_friend_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); friend_name text; friend_avatar text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if public.friendship_state(player_id,p_friend_id)<>'accepted' then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  select pseudo,avatar_url into friend_name,friend_avatar from public.user_profiles where user_id=p_friend_id;
  return jsonb_build_object('friend',jsonb_build_object('id',p_friend_id,'pseudo',friend_name,'avatarUrl',friend_avatar),
    'balance',(select karas_balance from public.user_profiles where user_id=player_id),
    'ownCards',public.trade_card_json(array(select id from public.user_cards where user_id=player_id
      and not exists(select 1 from public.auctions where card_instance_id=user_cards.id and status='active'))),
    'friendCards',public.trade_card_json(array(select id from public.user_cards where user_id=p_friend_id
      and not exists(select 1 from public.auctions where card_instance_id=user_cards.id and status='active'))));
end; $$;

create or replace function public.list_trade_offers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'fromUser',o.from_user,'toUser',o.to_user,
    'incoming',o.to_user=player_id,'fromPseudo',fp.pseudo,'fromAvatarUrl',fp.avatar_url,
    'toPseudo',tp.pseudo,'toAvatarUrl',tp.avatar_url,'offeredCards',public.trade_card_json(o.offered_card_ids),
    'offeredKaras',o.offered_karas,'requestedCards',public.trade_card_json(o.requested_card_ids),
    'requestedKaras',o.requested_karas,'status',o.status,'parentOfferId',o.parent_offer_id,'createdAt',o.created_at)
    order by o.created_at desc),'[]'::jsonb) from public.trade_offers o
    join public.user_profiles fp on fp.user_id=o.from_user join public.user_profiles tp on tp.user_id=o.to_user
    where o.from_user=player_id or o.to_user=player_id);
end; $$;

create or replace function public.list_auctions()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player_id uuid := auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  return (with player_bids as materialized (select distinct b.auction_id from public.bids b where b.bidder_id=player_id)
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
        'rarity',c.rarete_base,'image',c.image_url,'catalogueImage',c.image_url,'shiny',uc.is_shiny),
      'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',p.pseudo,'sellerId',a.seller_id,
      'sellerAvatarUrl',p.avatar_url,'buyerId',a.buyer_id,'hasBid',pb.auction_id is not null,
      'popularity',coalesce(c.favoris_count,0),'bids',(select count(*) from public.bids b where b.auction_id=a.id),
      'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
    ) order by a.ends_at),'[]'::jsonb)
    from public.auctions a join public.user_cards uc on uc.id=a.card_instance_id
    join public.cards c on c.id=uc.card_id join public.user_profiles p on p.user_id=a.seller_id
    left join player_bids pb on pb.auction_id=a.id
    where a.status='active' or a.seller_id=player_id or a.buyer_id=player_id or pb.auction_id is not null);
end; $$;

create or replace function public.get_auction(p_auction_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player_id uuid := auth.uid(); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  select jsonb_build_object('id',a.id,'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,
    'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url,'catalogueImage',c.image_url,'shiny',uc.is_shiny),
    'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',p.pseudo,'sellerId',a.seller_id,
    'sellerAvatarUrl',p.avatar_url,'buyerId',a.buyer_id,'bids',(select count(*) from public.bids b where b.auction_id=a.id),
    'winner',(select pseudo from public.user_profiles where user_id=a.buyer_id),
    'balance',(select karas_balance from public.user_profiles where user_id=player_id),
    'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',bp.pseudo,'avatarUrl',bp.avatar_url,
      'amount',b.amount,'createdAt',b.created_at,'mine',b.bidder_id=player_id) order by b.created_at desc),'[]'::jsonb)
      from public.bids b join public.user_profiles bp on bp.user_id=b.bidder_id where b.auction_id=a.id)) into result
    from public.auctions a join public.user_cards uc on uc.id=a.card_instance_id join public.cards c on c.id=uc.card_id
    join public.user_profiles p on p.user_id=a.seller_id where a.id=p_auction_id;
  if result is null then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;

revoke all on function public.search_users(text),public.get_friendships(),public.get_trade_context(uuid),
  public.list_trade_offers(),public.list_auctions(),public.get_auction(uuid) from public,anon;
grant execute on function public.search_users(text),public.get_friendships(),public.get_trade_context(uuid),
  public.list_trade_offers(),public.list_auctions(),public.get_auction(uuid) to authenticated;

commit;
