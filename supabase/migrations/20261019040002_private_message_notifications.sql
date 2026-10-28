-- First production version follows the coordinated PERF/ENG migrations.
begin;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
'wishlist_card_on_auction','friend_request','outbid','trade_offer_received','trade_counter_offer_received',
'trade_offer_accepted','trade_offer_declined','trade_offer_cancelled','auction_won','auction_sold',
'auction_chat_mention','achievement_completed','private_message_received'));

create or replace function public.interaction_notification_actor(n public.notifications)
returns uuid language sql stable security definer set search_path='' as $$
  select case
    when n.type in ('auction_chat_mention','private_message_received') then n.actor_user_id
    when n.type='friend_request' then (select user_id from public.friendships where id=n.reference_id)
    when n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_cancelled') then (select from_user from public.trade_offers where id=n.reference_id)
    when n.type in ('trade_offer_accepted','trade_offer_declined') then (select to_user from public.trade_offers where id=n.reference_id)
  end
$$;

create function public.notify_private_message()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Coalesce by sender: no message body/GIF in notifications, and one unread item per conversation.
  insert into public.notifications(user_id,type,reference_id,actor_user_id,created_at)
    values(new.recipient_id,'private_message_received',new.sender_id,new.sender_id,clock_timestamp())
    on conflict(user_id,type,reference_id) do update
      set actor_user_id=excluded.actor_user_id,read_at=null,created_at=excluded.created_at;
  return new;
end; $$;
revoke all on function public.notify_private_message() from public,anon,authenticated,service_role;
create trigger private_messages_notify after insert on public.private_messages
  for each row execute function public.notify_private_message();

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg((jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',coalesce(n.reference_id::text,n.achievement_id),'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'achievementName',achievement.titre,
      'actorPseudo',coalesce(mention_actor.pseudo,friend_sender.pseudo,trade_actor.pseudo,case when n.type in ('auction_chat_mention','friend_request','trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled') then 'Deleted player' end)
    ) || case when n.type='auction_sold' then jsonb_build_object('karaAmount',a.current_price) else '{}'::jsonb end)
      order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id and (type<>'private_message_received' or public.private_messaging_allowed(player_id,actor_user_id)) and not public.users_blocked(player_id,public.interaction_notification_actor(notifications)) order by created_at desc limit safe_limit) n
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

-- The notification rows contain no message text. RLS remains recipient-only.
-- Only INSERT/UPDATE are subscribed to by the browser; DELETE payloads are never used.
do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end; $$;
notify pgrst, 'reload schema';
commit;
