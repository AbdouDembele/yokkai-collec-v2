begin;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('wishlist_card_on_auction','friend_request','outbid','trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled','auction_won','auction_sold','auction_chat_mention','achievement_completed'));

alter table public.notifications
  add column actor_user_id uuid references auth.users(id) on delete set null;

create or replace function public.get_auction_chat(p_auction_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); sale_status text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select status into sale_status from public.auctions where id=p_auction_id;
  if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  return jsonb_build_object(
    'canPost',sale_status='active' and exists(select 1 from public.bids where auction_id=p_auction_id and bidder_id=player_id),
    'participants',(select coalesce(jsonb_agg(jsonb_build_object(
      'userId',participants.user_id,'pseudo',participants.pseudo,'avatarUrl',participants.avatar_url,
      'mine',participants.user_id=player_id
    ) order by lower(participants.pseudo),participants.user_id),'[]'::jsonb)
      from (select distinct p.user_id,p.pseudo,p.avatar_url
        from public.bids b join public.user_profiles p on p.user_id=b.bidder_id
        where b.auction_id=p_auction_id) participants),
    'messages',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'userId',m.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,
      'message',m.message,'createdAt',m.created_at,'mine',m.user_id=player_id
    ) order by m.created_at,m.id),'[]'::jsonb)
      from (select * from public.auction_chat_messages where auction_id=p_auction_id
        order by created_at desc,id desc limit 100) m
      join public.user_profiles p on p.user_id=m.user_id)
  );
end; $$;

create or replace function public.send_auction_chat_message(p_auction_id uuid,p_message text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  player_id uuid:=auth.uid();
  clean_message text:=btrim(coalesce(p_message,''));
  inserted public.auction_chat_messages%rowtype;
  player public.user_profiles%rowtype;
  mentioned_pseudo text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.auctions where id=p_auction_id) then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  if not exists(select 1 from public.auctions where id=p_auction_id and status='active' and ends_at>clock_timestamp()) then raise exception 'AUCTION_CLOSED' using errcode='P0001'; end if;
  if not exists(select 1 from public.bids where auction_id=p_auction_id and bidder_id=player_id) then raise exception 'CHAT_BIDDERS_ONLY' using errcode='P0001'; end if;
  if char_length(clean_message) not between 1 and 500 then raise exception 'CHAT_MESSAGE_INVALID' using errcode='P0001'; end if;

  for mentioned_pseudo in
    select distinct match[1] from regexp_matches(clean_message,'@([[:alnum:]_.-]{3,30})','g') match
  loop
    if not exists(
      select 1 from public.bids b join public.user_profiles p on p.user_id=b.bidder_id
      where b.auction_id=p_auction_id and lower(p.pseudo)=lower(mentioned_pseudo)
    ) then
      raise exception 'CHAT_MENTION_INVALID' using errcode='P0001';
    end if;
  end loop;

  insert into public.auction_chat_messages(auction_id,user_id,message)
    values(p_auction_id,player_id,clean_message) returning * into inserted;

  insert into public.notifications(user_id,type,reference_id,actor_user_id)
  select distinct p.user_id,'auction_chat_mention',p_auction_id,player_id
  from regexp_matches(clean_message,'@([[:alnum:]_.-]{3,30})','g') match
  join public.user_profiles p on lower(p.pseudo)=lower(match[1])
  join public.bids b on b.auction_id=p_auction_id and b.bidder_id=p.user_id
  where p.user_id<>player_id
  on conflict (user_id,type,reference_id) do update
    set actor_user_id=excluded.actor_user_id,read_at=null,created_at=clock_timestamp();

  select * into player from public.user_profiles where user_id=player_id;
  return jsonb_build_object('id',inserted.id,'userId',player_id,'pseudo',player.pseudo,'avatarUrl',player.avatar_url,
    'message',inserted.message,'createdAt',inserted.created_at,'mine',true);
end; $$;

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg((jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',coalesce(n.reference_id::text,n.achievement_id),'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'achievementName',achievement.titre,
      'actorPseudo',coalesce(mention_actor.pseudo,friend_sender.pseudo,trade_actor.pseudo)
    ) || case when n.type='auction_sold' then jsonb_build_object('karaAmount',a.current_price) else '{}'::jsonb end)
      order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id order by created_at desc limit safe_limit) n
    left join public.auctions a on n.type in ('wishlist_card_on_auction','outbid','auction_won','auction_sold','auction_chat_mention') and a.id=n.reference_id
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.user_profiles mention_actor on mention_actor.user_id=n.actor_user_id
    left join public.friendships f on n.type='friend_request' and f.id=n.reference_id
    left join public.user_profiles friend_sender on friend_sender.user_id=f.user_id
    left join public.trade_offers trade on n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled') and trade.id=n.reference_id
    left join public.user_profiles trade_actor on trade_actor.user_id=case
      when n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_cancelled') then trade.from_user
      when n.type in ('trade_offer_accepted','trade_offer_declined') then trade.to_user
    end
    left join public.achievements achievement on achievement.id=n.achievement_id);
end; $$;

commit;
