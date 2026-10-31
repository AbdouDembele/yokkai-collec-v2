begin;

create table public.push_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text primary key check (length(endpoint)<=2048 and endpoint ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/[^#]*$'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}=?$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}(==)?$'),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
grant select,delete on public.push_subscriptions to service_role;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy push_subscriptions_require_unbanned_insert on public.push_subscriptions as restrictive
  for insert to authenticated with check ((select public.assert_player_not_banned()));
create policy push_subscriptions_require_unbanned_update on public.push_subscriptions as restrictive
  for update to authenticated using ((select public.assert_player_not_banned()))
  with check ((select public.assert_player_not_banned()));
create policy push_subscriptions_require_unbanned_delete on public.push_subscriptions as restrictive
  for delete to authenticated using ((select public.assert_player_not_banned()));

-- Provisioned separately by the operator: never put secrets in a migration.
-- RLS plus no API grants keeps this singleton inaccessible to players and service_role.
create table public.push_dispatch_config (
  id boolean primary key default true check(id),
  url text not null check (url ~ '^https://[^/@?#]+/api/push/dispatch$'),
  secret text not null check (length(secret)>=32)
);
alter table public.push_dispatch_config enable row level security;
revoke all on public.push_dispatch_config from public,anon,authenticated,service_role;

create function public.dispatch_notification_push() returns trigger
language plpgsql security definer set search_path='' as $$
declare config public.push_dispatch_config%rowtype;
begin
  -- A read receipt is not a new event. DM/wall upserts advance created_at.
  if tg_op='UPDATE' and new.created_at is not distinct from old.created_at then return new; end if;
  if not exists(select 1 from public.push_subscriptions where user_id=new.user_id) then return new; end if;
  select * into config from public.push_dispatch_config where id;
  if not found then return new; end if;
  -- Dynamic call keeps the schema replayable on PGlite without an HTTP extension.
  -- Provision pg_net before activating the config row in production.
  execute 'select net.http_post(url := $1,body := $2,headers := $3,timeout_milliseconds := 10000)'
    using config.url,jsonb_build_object('id',new.id,'createdAt',new.created_at),
      jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||config.secret);
  return new;
exception when others then
  -- Push is best-effort: never roll back an auction/trade/message on network failure.
  raise warning 'PUSH_DISPATCH_FAILED (%)',sqlstate;
  return new;
end; $$;
revoke all on function public.dispatch_notification_push() from public,anon,authenticated,service_role;
create trigger notifications_push after insert or update on public.notifications
  for each row execute function public.dispatch_notification_push();


create function public.get_push_notification(p_id uuid,p_created_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare player_id uuid; result jsonb; previous_sub text:=current_setting('request.jwt.claim.sub',true);
begin
  select user_id into player_id from public.notifications where id=p_id and created_at=p_created_at;
  if player_id is null then return null; end if;
  -- Existing ACL helpers use auth.uid(); identity comes only from the stored row.
  perform set_config('request.jwt.claim.sub',player_id::text,true);
  if not public.wall_actor_visible(player_id) then
    perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    return null;
  end if;
  result:=(select coalesce(jsonb_agg((jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',coalesce(n.reference_id::text,n.achievement_id),'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'achievementName',achievement.titre,
      'actorPseudo',coalesce(mention_actor.pseudo,friend_sender.pseudo,trade_actor.pseudo)
    ) || case when n.type='auction_sold' then jsonb_build_object('karaAmount',a.current_price) else '{}'::jsonb end)
      order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id and id=p_id and created_at=p_created_at
      and (type<>'private_message_received' or public.private_messaging_allowed(player_id,actor_user_id))
      and (type<>'wall_post_reply' or (
        public.wall_actor_visible(player_id) and public.wall_reply_author_visible(actor_user_id)
        and exists(select 1 from public.profile_wall_posts w where w.id=reference_id and w.user_id=player_id)
        and exists(select 1 from public.wall_post_replies r where r.post_id=reference_id and r.user_id=actor_user_id)
        and public.wall_post_interaction_allowed(actor_user_id,reference_id)
      ))
      and not public.users_blocked(player_id,public.interaction_notification_actor(notifications))
      order by created_at desc) n
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
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  return jsonb_build_object('userId',player_id,'locale',(select locale from public.user_profiles where user_id=player_id),'notification',result->0);
end; $$;
revoke all on function public.get_push_notification(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.get_push_notification(uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
