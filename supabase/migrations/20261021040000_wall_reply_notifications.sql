begin;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in (
  'wishlist_card_on_auction','friend_request','outbid','trade_offer_received','trade_counter_offer_received',
  'trade_offer_accepted','trade_offer_declined','trade_offer_cancelled','auction_won','auction_sold',
  'auction_chat_mention','achievement_completed','private_message_received','wall_post_reply'));

create or replace function public.interaction_notification_actor(n public.notifications)
returns uuid language sql stable security definer set search_path='' as $$
  select case
    when n.type in ('auction_chat_mention','private_message_received','wall_post_reply') then n.actor_user_id
    when n.type='friend_request' then (select user_id from public.friendships where id=n.reference_id)
    when n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_cancelled') then (select from_user from public.trade_offers where id=n.reference_id)
    when n.type in ('trade_offer_accepted','trade_offer_declined') then (select to_user from public.trade_offers where id=n.reference_id)
  end
$$;

create function public.notify_wall_post_reply() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  select user_id into owner_id from public.profile_wall_posts where id=new.post_id;
  if owner_id is null or owner_id=new.user_id
    or not public.wall_actor_visible(owner_id) or not public.wall_actor_visible(new.user_id)
    or not exists(select 1 from public.friendships where status='accepted' and
      ((user_id=owner_id and friend_id=new.user_id) or (friend_id=owner_id and user_id=new.user_id)))
    then return new; end if;
  -- One item per post, not per reply. Store neither the post body nor reply text.
  -- The publication RPC inserts only once for an idempotent retry.
  insert into public.notifications(user_id,type,reference_id,actor_user_id,created_at)
    values(owner_id,'wall_post_reply',new.post_id,new.user_id,clock_timestamp())
    on conflict(user_id,type,reference_id) do update
      set actor_user_id=excluded.actor_user_id,read_at=null,created_at=clock_timestamp();
  return new;
end; $$;
revoke all on function public.notify_wall_post_reply() from public,anon,authenticated,service_role;
create trigger wall_post_replies_notify after insert on public.wall_post_replies
  for each row execute function public.notify_wall_post_reply();

create function public.cleanup_wall_reply_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Also runs when the parent post/account deletion cascades to its replies.
  delete from public.notifications n where n.type='wall_post_reply' and n.reference_id=old.post_id
    and not exists(select 1 from public.wall_post_replies r where r.post_id=old.post_id and r.user_id=n.actor_user_id);
  return old;
end; $$;
revoke all on function public.cleanup_wall_reply_notifications() from public,anon,authenticated,service_role;
create trigger wall_post_replies_notification_cleanup after delete on public.wall_post_replies
  for each row execute function public.cleanup_wall_reply_notifications();

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
    from (select * from public.notifications where user_id=player_id
      and (type<>'private_message_received' or public.private_messaging_allowed(player_id,actor_user_id))
      and (type<>'wall_post_reply' or (
        public.wall_actor_visible(player_id) and public.wall_actor_visible(actor_user_id)
        and exists(select 1 from public.profile_wall_posts w where w.id=reference_id and w.user_id=player_id)
        and exists(select 1 from public.wall_post_replies r where r.post_id=reference_id and r.user_id=actor_user_id)
        and exists(select 1 from public.friendships f where f.status='accepted' and
          ((f.user_id=player_id and f.friend_id=actor_user_id) or (f.friend_id=player_id and f.user_id=actor_user_id)))
      ))
      and not public.users_blocked(player_id,public.interaction_notification_actor(notifications))
      order by created_at desc limit safe_limit) n
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

-- Existing recipient-only RLS, INSERT/UPDATE realtime and mark-as-read stay intact.
-- No new callable RPC or direct table privileges are granted.
notify pgrst,'reload schema';
commit;
