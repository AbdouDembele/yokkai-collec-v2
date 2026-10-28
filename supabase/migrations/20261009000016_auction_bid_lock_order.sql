begin;

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
  -- Both the debit and refund lock these rows: always acquire them by UUID.
  perform 1 from public.user_profiles
    where user_id in (player_id,old_buyer)
    order by user_id for no key update;
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

commit;
