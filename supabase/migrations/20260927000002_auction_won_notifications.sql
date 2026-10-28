begin;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('wishlist_card_on_auction','friend_request','outbid','trade_offer_received','auction_won'));

create or replace function public.settle_expired_auctions()
returns void language plpgsql volatile security definer set search_path='' as $$
declare sale record;
begin
  for sale in select * from public.auctions where status='active' and ends_at<=clock_timestamp()
    order by ends_at for update skip locked loop
    if sale.buyer_id is null then
      update public.auctions set status='expired' where id=sale.id;
    else
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
  end loop;
end; $$;

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',n.reference_id,'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,
      'actorPseudo',coalesce(friend_sender.pseudo,trade_sender.pseudo)
    ) order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id order by created_at desc limit safe_limit) n
    left join public.auctions a on n.type in ('wishlist_card_on_auction','outbid','auction_won') and a.id=n.reference_id
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.friendships f on n.type='friend_request' and f.id=n.reference_id
    left join public.user_profiles friend_sender on friend_sender.user_id=f.user_id
    left join public.trade_offers trade on n.type='trade_offer_received' and trade.id=n.reference_id
    left join public.user_profiles trade_sender on trade_sender.user_id=trade.from_user);
end; $$;

commit;
