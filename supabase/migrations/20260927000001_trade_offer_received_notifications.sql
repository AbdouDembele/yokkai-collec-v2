begin;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('wishlist_card_on_auction','friend_request','outbid','trade_offer_received'));

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
    values(p_to_user,'trade_offer_received',offer_id);
  return offer_id;
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
    left join public.auctions a on n.type in ('wishlist_card_on_auction','outbid') and a.id=n.reference_id
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.friendships f on n.type='friend_request' and f.id=n.reference_id
    left join public.user_profiles friend_sender on friend_sender.user_id=f.user_id
    left join public.trade_offers trade on n.type='trade_offer_received' and trade.id=n.reference_id
    left join public.user_profiles trade_sender on trade_sender.user_id=trade.from_user);
end; $$;

commit;
