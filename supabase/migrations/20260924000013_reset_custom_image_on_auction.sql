begin;

create or replace function public.create_auction(p_card_instance_id uuid,p_starting_price integer default 10,p_duration_minutes integer default 60)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); auction_id uuid;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  if p_starting_price<10 then raise exception 'INVALID_AUCTION_PRICE' using errcode='P0001'; end if;
  if p_duration_minutes not in (15,30,60,240,720,1440) then raise exception 'INVALID_AUCTION_DURATION' using errcode='P0001'; end if;
  perform 1 from public.user_cards where id=p_card_instance_id and user_id=player_id for update;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  update public.user_cards set custom_image_url=null where id=p_card_instance_id;
  insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,current_price)
    values(p_card_instance_id,player_id,p_starting_price,p_duration_minutes,clock_timestamp()+make_interval(mins=>p_duration_minutes),p_starting_price)
    returning id into auction_id;
  return auction_id;
exception when unique_violation then raise exception 'CARD_FROZEN' using errcode='P0001';
end; $$;

create or replace function public.list_auctions()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'rarity',c.rarete_base,
      'image',c.image_url,'shiny',uc.is_shiny),
    'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',p.pseudo,'sellerId',a.seller_id,
    'buyerId',a.buyer_id,'bids',(select count(*) from public.bids b where b.auction_id=a.id),
    'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
  ) order by a.ends_at),'[]'::jsonb) from public.auctions a join public.user_cards uc on uc.id=a.card_instance_id
    join public.cards c on c.id=uc.card_id join public.user_profiles p on p.user_id=a.seller_id
    where a.status='active' or a.seller_id=player_id or a.buyer_id=player_id);
end; $$;

create or replace function public.get_auction(p_auction_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  select jsonb_build_object('id',a.id,'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'rarity',c.rarete_base,
      'image',c.image_url,'shiny',uc.is_shiny),
    'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',p.pseudo,'sellerId',a.seller_id,'buyerId',a.buyer_id,
    'bids',(select count(*) from public.bids b where b.auction_id=a.id),
    'winner',(select pseudo from public.user_profiles where user_id=a.buyer_id),'balance',(select karas_balance from public.user_profiles where user_id=player_id),
    'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',bp.pseudo,'amount',b.amount,'createdAt',b.created_at,'mine',b.bidder_id=player_id) order by b.created_at desc),'[]'::jsonb)
      from public.bids b join public.user_profiles bp on bp.user_id=b.bidder_id where b.auction_id=a.id)) into result
    from public.auctions a join public.user_cards uc on uc.id=a.card_instance_id join public.cards c on c.id=uc.card_id
    join public.user_profiles p on p.user_id=a.seller_id where a.id=p_auction_id;
  if result is null then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;

commit;
