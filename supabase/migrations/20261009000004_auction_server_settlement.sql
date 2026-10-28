begin;

-- Administrative activation is deliberately outside postgres-only migrations.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'PG_CRON_REQUIRED: run scripts/admin/enable-pg-cron.sh before this migration';
  end if;
  if current_user <> 'postgres' then
    raise exception 'This migration must run as postgres';
  end if;
end;
$$;

-- Named schedule replaces the same owner's existing job instead of duplicating it.
select cron.schedule('settle-expired-auctions', '* * * * *', 'select public.settle_expired_auctions();');

create or replace function public.list_auctions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare player_id uuid := auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
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
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare player_id uuid := auth.uid(); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
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

create or replace function public.get_my_active_auction_cards()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;



  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'instanceId', a.card_instance_id,
      'auctionId', a.id,
      'endsAt', a.ends_at
    ) order by a.ends_at), '[]'::jsonb)
    from public.auctions a
    where a.seller_id = player_id
      and a.status = 'active'
      and a.card_instance_id is not null
  );
end;
$$;

commit;
