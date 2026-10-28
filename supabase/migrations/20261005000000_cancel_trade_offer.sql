begin;

alter table public.trade_offers drop constraint trade_offers_status_check;
alter table public.trade_offers add constraint trade_offers_status_check
  check (status in ('pending','accepted','declined','countered','cancelled'));

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('wishlist_card_on_auction','friend_request','outbid','trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled','auction_won','achievement_completed'));

create function public.cancel_trade_offer(p_offer_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); offer public.trade_offers%rowtype;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select * into offer from public.trade_offers where id=p_offer_id for update;
  if not found then raise exception 'TRADE_NOT_FOUND' using errcode='P0001'; end if;
  if offer.from_user<>player_id then raise exception 'TRADE_NOT_AUTHOR' using errcode='P0001'; end if;
  if offer.status='accepted' then raise exception 'TRADE_ALREADY_ACCEPTED' using errcode='P0001'; end if;
  if offer.status='declined' then raise exception 'TRADE_ALREADY_DECLINED' using errcode='P0001'; end if;
  if offer.status='cancelled' then raise exception 'TRADE_ALREADY_CANCELLED' using errcode='P0001'; end if;
  if offer.status='countered' then raise exception 'TRADE_ALREADY_COUNTERED' using errcode='P0001'; end if;
  update public.trade_offers set status='cancelled',updated_at=clock_timestamp() where id=offer.id;
  insert into public.notifications(user_id,type,reference_id) values(offer.to_user,'trade_offer_cancelled',offer.id);
  return true;
end; $$;

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',coalesce(n.reference_id::text,n.achievement_id),'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'achievementName',achievement.titre,
      'actorPseudo',coalesce(friend_sender.pseudo,trade_actor.pseudo)
    ) order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id order by created_at desc limit safe_limit) n
    left join public.auctions a on n.type in ('wishlist_card_on_auction','outbid','auction_won') and a.id=n.reference_id
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.friendships f on n.type='friend_request' and f.id=n.reference_id
    left join public.user_profiles friend_sender on friend_sender.user_id=f.user_id
    left join public.trade_offers trade on n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled') and trade.id=n.reference_id
    left join public.user_profiles trade_actor on trade_actor.user_id=case
      when n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_cancelled') then trade.from_user
      when n.type in ('trade_offer_accepted','trade_offer_declined') then trade.to_user
    end
    left join public.achievements achievement on achievement.id=n.achievement_id);
end; $$;

revoke all on function public.cancel_trade_offer(uuid) from public,anon,authenticated;
grant execute on function public.cancel_trade_offer(uuid) to authenticated;

commit;
