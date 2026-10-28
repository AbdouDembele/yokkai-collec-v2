begin;

-- Keep legacy no-argument RPCs for cached fronts. Only the new endpoints are bounded.
create function public.list_trade_offers_page(p_cursor jsonb default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); page_size integer:=least(p_limit,100);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_limit is null or p_limit<1 then raise exception 'INVALID_PAGE_SIZE' using errcode='P0001'; end if;
  return (with selected as materialized (
    select o.*,fp.pseudo from_pseudo,fp.avatar_url from_avatar,tp.pseudo to_pseudo,tp.avatar_url to_avatar
    from public.trade_offers o
    join public.user_profiles fp on fp.user_id=o.from_user join public.user_profiles tp on tp.user_id=o.to_user
    where (o.from_user=player_id or o.to_user=player_id)
      and (p_cursor is null or (o.created_at,o.id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
    order by o.created_at desc,o.id desc limit page_size
  ) select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,'fromUser',o.from_user,'toUser',o.to_user,'incoming',o.to_user=player_id,
      'fromPseudo',o.from_pseudo,'fromAvatarUrl',o.from_avatar,'toPseudo',o.to_pseudo,'toAvatarUrl',o.to_avatar,
      'offeredCards',public.trade_card_json(o.offered_card_ids),'offeredKaras',o.offered_karas,
      'requestedCards',public.trade_card_json(o.requested_card_ids),'requestedKaras',o.requested_karas,
      'status',o.status,'parentOfferId',o.parent_offer_id,'createdAt',o.created_at
    ) order by o.created_at desc,o.id desc),'[]'::jsonb),
    'nextCursor',case when count(*)=page_size then
      jsonb_agg(jsonb_build_object('createdAt',o.created_at,'id',o.id) order by o.created_at,o.id)->0 end
  ) from selected o);
end; $$;

create function public.list_auctions_page(p_cursor jsonb default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); page_size integer:=least(p_limit,100);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_limit is null or p_limit<1 then raise exception 'INVALID_PAGE_SIZE' using errcode='P0001'; end if;
  return (with player_bids as materialized (select distinct b.auction_id from public.bids b where b.bidder_id=player_id),
  selected as materialized (
    select a.*,uc.is_shiny,c.id card_id,c.nom,c.categorie,c.franchise,c.rarete_base,c.image_url,c.favoris_count,
      p.pseudo,p.avatar_url,pb.auction_id is not null has_bid
    from public.auctions a join public.user_cards uc on uc.id=a.card_instance_id
    join public.cards c on c.id=uc.card_id join public.user_profiles p on p.user_id=a.seller_id
    left join player_bids pb on pb.auction_id=a.id
    where (a.status='active' or a.seller_id=player_id or a.buyer_id=player_id or pb.auction_id is not null)
      and (p_cursor is null or (a.created_at,a.id)>((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
    -- Immutable cursor: anti-sniping changes ends_at, never created_at.
    order by a.created_at,a.id limit page_size
  ) select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'card',jsonb_build_object('id',a.card_id,'name',a.nom,'category',a.categorie,'anime',a.franchise,
        'rarity',a.rarete_base,'image',a.image_url,'catalogueImage',a.image_url,'shiny',a.is_shiny),
      'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',a.pseudo,'sellerId',a.seller_id,
      'sellerAvatarUrl',a.avatar_url,'buyerId',a.buyer_id,'hasBid',a.has_bid,'popularity',coalesce(a.favoris_count,0),
      'bids',(select count(*) from public.bids b where b.auction_id=a.id),
      'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
    ) order by a.created_at,a.id),'[]'::jsonb),
    'nextCursor',case when count(*)=page_size then
      jsonb_agg(jsonb_build_object('createdAt',a.created_at,'id',a.id) order by a.created_at desc,a.id desc)->0 end
  ) from selected a);
end; $$;

revoke all on function public.list_trade_offers_page(jsonb,integer),public.list_auctions_page(jsonb,integer)
  from public,anon,authenticated;
grant execute on function public.list_trade_offers_page(jsonb,integer),public.list_auctions_page(jsonb,integer)
  to authenticated;

commit;
