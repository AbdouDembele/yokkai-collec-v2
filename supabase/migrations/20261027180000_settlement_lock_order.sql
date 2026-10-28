begin;
set local lock_timeout='3s';

-- #390: settlement used to lock the sold card before the seller's profile
-- (credit_karas), while respond_trade_offer locks both profiles before its
-- cards. A trade touching the sold card could therefore deadlock (40P01).
-- Common order everywhere: auction / trade offer row, then profiles by user_id
-- (as place_bid and respond_trade_offer), then cards by id.
create or replace function public.settle_expired_auctions()
returns void language plpgsql volatile security definer set search_path='' as $$
declare sale record;
begin
  for sale in select * from public.auctions where status='active' and ends_at<=clock_timestamp()
    order by ends_at for update skip locked loop
    begin
      if sale.buyer_id is null then
        update public.auctions set status='expired' where id=sale.id;
      else
        perform 1 from public.user_profiles where user_id in (sale.seller_id,sale.buyer_id) order by user_id for update;
        perform 1 from public.user_cards where id=sale.card_instance_id for update;
        update public.auctions set status='sold' where id=sale.id;
        update public.user_cards set user_id=sale.buyer_id,folder_id=null,is_first_owner=false,date_obtention=clock_timestamp()
          where id=sale.card_instance_id;
        delete from public.wishlist where user_id=sale.buyer_id
          and card_id=(select card_id from public.user_cards where id=sale.card_instance_id);
        perform public.credit_karas(sale.seller_id,sale.current_price);
        insert into public.notifications(user_id,type,reference_id)
          values(sale.buyer_id,'auction_won',sale.id)
          on conflict do nothing;
      end if;
    exception when deadlock_detected or lock_not_available then
      -- Controlled retry: this sale alone is rolled back and stays active; the
      -- next cron run (every minute) settles it. Other sales are unaffected.
      raise warning 'AUCTION_SETTLEMENT_DEFERRED % (%)', sale.id, sqlstate;
    end;
  end loop;
end; $$;

commit;
