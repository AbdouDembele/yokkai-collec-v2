begin;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('wishlist_card_on_auction','friend_request','outbid'));

create or replace function public.place_bid(p_auction_id uuid,p_amount integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); sale public.auctions%rowtype; old_buyer uuid; old_price integer; balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  select * into sale from public.auctions where id=p_auction_id for update;
  if not found or sale.status<>'active' then raise exception 'AUCTION_CLOSED' using errcode='P0001'; end if;
  if sale.seller_id=player_id then raise exception 'SELLER_CANNOT_BID' using errcode='P0001'; end if;
  if p_amount<sale.current_price+10 then raise exception 'BID_TOO_LOW' using errcode='P0001'; end if;
  old_buyer:=sale.buyer_id; old_price:=sale.current_price;
  if old_buyer=player_id then balance:=public.debit_karas(player_id,p_amount-old_price);
  else
    balance:=public.debit_karas(player_id,p_amount);
    if old_buyer is not null then perform public.credit_karas(old_buyer,old_price); end if;
  end if;
  update public.auctions set current_price=p_amount,buyer_id=player_id,
    ends_at=case when ends_at-clock_timestamp()<interval '5 minutes' then ends_at+interval '1 minute' else ends_at end
    where id=p_auction_id returning * into sale;
  insert into public.bids(auction_id,bidder_id,amount) values(p_auction_id,player_id,p_amount);
  if old_buyer is not null and old_buyer<>player_id then
    insert into public.notifications(user_id,type,reference_id)
      values(old_buyer,'outbid',p_auction_id)
      on conflict (user_id,type,reference_id) do update
        set read_at=null,created_at=clock_timestamp();
  end if;
  return jsonb_build_object('currentPrice',sale.current_price,'endsAt',sale.ends_at,'balance',balance);
end; $$;

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',n.reference_id,'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'actorPseudo',sender.pseudo
    ) order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id order by created_at desc limit safe_limit) n
    left join public.auctions a on n.type in ('wishlist_card_on_auction','outbid') and a.id=n.reference_id
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.friendships f on n.type='friend_request' and f.id=n.reference_id
    left join public.user_profiles sender on sender.user_id=f.user_id);
end; $$;

commit;
