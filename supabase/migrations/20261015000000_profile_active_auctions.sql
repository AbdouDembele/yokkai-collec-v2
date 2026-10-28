begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';

-- Read-only, bounded seller-specific feed. Bidding/cancellation keep the existing
-- marketplace RPCs and their transaction, balance and anti-sniping protections.
create function public.get_profile_active_auctions(
  p_owner_id uuid, p_cursor jsonb default null, p_limit integer default 20
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare viewer uuid := auth.uid(); base jsonb; page_size integer;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_owner_id is null then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  if p_limit is null or p_limit < 1 then raise exception 'INVALID_PAGE_SIZE' using errcode='P0001'; end if;
  page_size := least(p_limit,50);
  base := public.get_profile(p_owner_id::text);
  if not (base->>'canViewCollection')::boolean
    or exists(select 1 from public.account_deletion_log where user_id in(viewer,p_owner_id))
    or exists(select 1 from public.user_blocks where
      (blocker_id=viewer and blocked_id=p_owner_id) or (blocker_id=p_owner_id and blocked_id=viewer)) then
    return jsonb_build_object('items','[]'::jsonb,'nextCursor',null);
  end if;
  if p_cursor is not null and (jsonb_typeof(p_cursor) <> 'object'
    or nullif(p_cursor->>'createdAt','') is null or nullif(p_cursor->>'id','') is null) then
    raise exception 'INVALID_CURSOR' using errcode='P0001';
  end if;
  return (with selected as materialized (
    select a.*,c.id card_id,c.nom,c.categorie,c.franchise,c.rarete_base,c.image_url,uc.is_shiny
    from public.auctions a
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    where a.seller_id=p_owner_id and a.status='active' and a.ends_at>statement_timestamp()
      and (c.id is not null or a.card_snapshot is not null)
      and (p_cursor is null or (a.created_at,a.id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
    order by a.created_at desc,a.id desc limit page_size+1
  ), page as (select * from selected order by created_at desc,id desc limit page_size)
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'card',case when a.card_id is not null then jsonb_build_object(
        'id',a.card_id,'name',a.nom,'category',a.categorie,'anime',a.franchise,'liveFranchise',true,
        'rarity',a.rarete_base,'image',a.image_url,'catalogueImage',a.image_url,'shiny',a.is_shiny) else a.card_snapshot end,
      'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,
      'seller',base->>'pseudo','sellerId',p_owner_id,'sellerAvatarUrl',base->>'avatarUrl',
      'buyerId',a.buyer_id,'hasBid',exists(select 1 from public.bids b where b.auction_id=a.id and b.bidder_id=viewer),
      'bids',(select count(*) from public.bids b where b.auction_id=a.id),
      'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=viewer)
    ) order by a.created_at desc,a.id desc),'[]'::jsonb),
    'nextCursor',case when (select count(*) from selected)>page_size then
      jsonb_agg(jsonb_build_object('createdAt',a.created_at,'id',a.id) order by a.created_at,a.id)->0
      else null end
  ) from page a);
end; $$;

revoke all on function public.get_profile_active_auctions(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.get_profile_active_auctions(uuid,jsonb,integer) to authenticated;
commit;
