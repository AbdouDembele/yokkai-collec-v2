begin;

create index if not exists bids_bidder_auction_idx on public.bids(bidder_id,auction_id);

create or replace function public.list_auctions()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player_id uuid := auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  return (
    with player_bids as materialized (
      select distinct b.auction_id
      from public.bids b
      where b.bidder_id=player_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
        'rarity',c.rarete_base,'image',c.image_url,'catalogueImage',c.image_url,'shiny',uc.is_shiny),
      'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',p.pseudo,'sellerId',a.seller_id,
      'buyerId',a.buyer_id,'hasBid',pb.auction_id is not null,
      'bids',(select count(*) from public.bids b where b.auction_id=a.id),
      'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
    ) order by a.ends_at),'[]'::jsonb)
    from public.auctions a
    join public.user_cards uc on uc.id=a.card_instance_id
    join public.cards c on c.id=uc.card_id
    join public.user_profiles p on p.user_id=a.seller_id
    left join player_bids pb on pb.auction_id=a.id
    where a.status='active' or a.seller_id=player_id or a.buyer_id=player_id or pb.auction_id is not null
  );
end; $$;

grant execute on function public.list_auctions() to authenticated;

commit;
