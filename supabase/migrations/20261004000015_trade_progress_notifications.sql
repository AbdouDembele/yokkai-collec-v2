begin;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('wishlist_card_on_auction','friend_request','outbid','trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','auction_won','achievement_completed'));

create or replace function public.create_trade_offer(p_to_user uuid,p_offered_card_ids uuid[] default '{}',p_offered_karas integer default 0,
  p_requested_card_ids uuid[] default '{}',p_requested_karas integer default 0,p_parent_offer_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); offer_id uuid; parent public.trade_offers%rowtype;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  p_offered_card_ids:=coalesce(p_offered_card_ids,'{}'); p_requested_card_ids:=coalesce(p_requested_card_ids,'{}');
  if p_offered_karas<0 or p_requested_karas<0 then raise exception 'INVALID_TRADE_KARAS' using errcode='P0001'; end if;
  if cardinality(p_offered_card_ids)=0 and p_offered_karas=0 and cardinality(p_requested_card_ids)=0 and p_requested_karas=0 then raise exception 'EMPTY_TRADE' using errcode='P0001'; end if;
  if public.friendship_state(player_id,p_to_user)<>'accepted' then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  if cardinality(p_offered_card_ids)<>(select count(distinct id) from unnest(p_offered_card_ids) id)
    or cardinality(p_requested_card_ids)<>(select count(distinct id) from unnest(p_requested_card_ids) id) then raise exception 'DUPLICATE_TRADE_CARD' using errcode='P0001'; end if;
  if (select count(*) from public.user_cards where user_id=player_id and id=any(p_offered_card_ids))<>cardinality(p_offered_card_ids)
    or (select count(*) from public.user_cards where user_id=p_to_user and id=any(p_requested_card_ids))<>cardinality(p_requested_card_ids) then raise exception 'TRADE_CARD_UNAVAILABLE' using errcode='P0001'; end if;
  if exists(select 1 from public.auctions where status='active' and card_instance_id=any(p_offered_card_ids||p_requested_card_ids)) then raise exception 'TRADE_CARD_FROZEN' using errcode='P0001'; end if;
  if p_parent_offer_id is not null then
    select * into parent from public.trade_offers where id=p_parent_offer_id for update;
    if not found or parent.status<>'pending' or parent.to_user<>player_id or parent.from_user<>p_to_user then raise exception 'TRADE_NOT_COUNTERABLE' using errcode='P0001'; end if;
    update public.trade_offers set status='countered',updated_at=clock_timestamp() where id=parent.id;
  end if;
  insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,requested_card_ids,requested_karas,parent_offer_id)
    values(player_id,p_to_user,p_offered_card_ids,p_offered_karas,p_requested_card_ids,p_requested_karas,p_parent_offer_id) returning id into offer_id;
  insert into public.notifications(user_id,type,reference_id)
    values(p_to_user,case when p_parent_offer_id is null then 'trade_offer_received' else 'trade_counter_offer_received' end,offer_id);
  return offer_id;
end; $$;

create or replace function public.respond_trade_offer(p_offer_id uuid,p_action text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); offer public.trade_offers%rowtype;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_action not in ('accept','decline') then raise exception 'INVALID_TRADE_ACTION' using errcode='P0001'; end if;
  select * into offer from public.trade_offers where id=p_offer_id for update;
  if not found or offer.status<>'pending' or offer.to_user<>player_id then raise exception 'TRADE_NOT_PENDING' using errcode='P0001'; end if;
  if p_action='decline' then
    update public.trade_offers set status='declined',updated_at=clock_timestamp() where id=offer.id;
    insert into public.notifications(user_id,type,reference_id) values(offer.from_user,'trade_offer_declined',offer.id);
    return false;
  end if;
  if public.friendship_state(offer.from_user,offer.to_user)<>'accepted' then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  perform 1 from public.user_profiles where user_id in (offer.from_user,offer.to_user) order by user_id for update;
  perform 1 from public.user_cards where id=any(offer.offered_card_ids||offer.requested_card_ids) order by id for update;
  if (select count(*) from public.user_cards where user_id=offer.from_user and id=any(offer.offered_card_ids))<>cardinality(offer.offered_card_ids)
    or (select count(*) from public.user_cards where user_id=offer.to_user and id=any(offer.requested_card_ids))<>cardinality(offer.requested_card_ids) then raise exception 'TRADE_CARD_UNAVAILABLE' using errcode='P0001'; end if;
  if exists(select 1 from public.auctions where status='active' and card_instance_id=any(offer.offered_card_ids||offer.requested_card_ids)) then raise exception 'TRADE_CARD_FROZEN' using errcode='P0001'; end if;
  if (select karas_balance from public.user_profiles where user_id=offer.from_user)<offer.offered_karas
    or (select karas_balance from public.user_profiles where user_id=offer.to_user)<offer.requested_karas then raise exception 'TRADE_INSUFFICIENT_KARAS' using errcode='P0001'; end if;
  update public.user_profiles set karas_balance=karas_balance-offer.offered_karas+offer.requested_karas where user_id=offer.from_user;
  update public.user_profiles set karas_balance=karas_balance-offer.requested_karas+offer.offered_karas where user_id=offer.to_user;
  update public.user_cards set user_id=offer.to_user,folder_id=null,is_first_owner=false,date_obtention=clock_timestamp() where id=any(offer.offered_card_ids);
  update public.user_cards set user_id=offer.from_user,folder_id=null,is_first_owner=false,date_obtention=clock_timestamp() where id=any(offer.requested_card_ids);
  delete from public.wishlist w where (w.user_id=offer.to_user and w.card_id in (select card_id from public.user_cards where id=any(offer.offered_card_ids)))
    or (w.user_id=offer.from_user and w.card_id in (select card_id from public.user_cards where id=any(offer.requested_card_ids)));
  update public.trade_offers set status='accepted',updated_at=clock_timestamp() where id=offer.id;
  insert into public.notifications(user_id,type,reference_id) values(offer.from_user,'trade_offer_accepted',offer.id);
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
    left join public.trade_offers trade on n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined') and trade.id=n.reference_id
    left join public.user_profiles trade_actor on trade_actor.user_id=case
      when n.type in ('trade_offer_received','trade_counter_offer_received') then trade.from_user
      when n.type in ('trade_offer_accepted','trade_offer_declined') then trade.to_user
    end
    left join public.achievements achievement on achievement.id=n.achievement_id);
end; $$;

commit;
