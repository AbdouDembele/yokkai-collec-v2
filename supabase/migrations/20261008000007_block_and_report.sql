begin;

create table public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (blocker_id,blocked_id),
  check (blocker_id<>blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks(blocked_id,blocker_id);

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('harassment','inappropriate','spam','cheating','other')),
  context_type text not null check (context_type in ('profile','auction_chat')),
  context_id uuid,
  snapshot jsonb not null default '{}',
  details text not null default '' check (char_length(details)<=500),
  status text not null default 'pending' check (status in ('pending','reviewed','dismissed')),
  created_at timestamptz not null default clock_timestamp(),
  check (reporter_id<>reported_id),
  check ((context_type='profile' and context_id is null) or (context_type='auction_chat' and context_id is not null)),
  unique nulls not distinct (reporter_id,reported_id,context_type,context_id)
);
create index user_reports_reporter_created_idx on public.user_reports(reporter_id,created_at);
create index user_reports_status_created_idx on public.user_reports(status,created_at desc,id desc);
alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;
revoke all on table public.user_blocks,public.user_reports from public,anon,authenticated;

-- Internal predicate, never executable by API roles.
create function public.users_blocked(p_first uuid,p_second uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.user_blocks where
    (blocker_id=p_first and blocked_id=p_second) or (blocker_id=p_second and blocked_id=p_first))
$$;

-- Serialize friendship creation even when no friendship row exists.
-- This lock is only used by friendship mutations and block/unblock.
create function public.lock_social_pair(p_first uuid,p_second uuid)
returns void language sql volatile security definer set search_path='' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'social:'||least(p_first,p_second)::text||':'||greatest(p_first,p_second)::text,0))
$$;

create or replace function public.send_friend_request(p_friend_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); request_id uuid;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_friend_id is null or p_friend_id=player_id then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  perform public.lock_social_pair(player_id,p_friend_id);
  if public.users_blocked(player_id,p_friend_id) or not exists(select 1 from public.user_profiles where user_id=p_friend_id)
    then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  insert into public.friendships(user_id,friend_id) values(player_id,p_friend_id) returning id into request_id;
  return request_id;
exception when unique_violation then raise exception 'FRIENDSHIP_EXISTS' using errcode='P0001';
end; $$;

create or replace function public.respond_friend_request(p_request_id uuid,p_accept boolean)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); sender_id uuid;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select user_id into sender_id from public.friendships where id=p_request_id and friend_id=player_id and status='pending';
  if not found or p_accept is null then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  perform public.lock_social_pair(player_id,sender_id);
  if public.users_blocked(player_id,sender_id) then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  if p_accept then
    update public.friendships set status='accepted',updated_at=clock_timestamp()
      where id=p_request_id and friend_id=player_id and status='pending';
  else
    delete from public.friendships where id=p_request_id and friend_id=player_id and status='pending';
  end if;
  if not found then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  return p_accept;
end; $$;

create function public.guard_blocked_trade()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    -- Friendship first; held until the inserting transaction ends.
    perform 1 from public.friendships where status='accepted' and
      ((user_id=new.from_user and friend_id=new.to_user) or (user_id=new.to_user and friend_id=new.from_user)) for share;
    if not found then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  elsif new.status<>'accepted' or old.status='accepted' then
    return new;
  end if;
  -- Acceptance MUST NOT acquire a friendship/pair lock: the offer row is already locked.
  if public.users_blocked(new.from_user,new.to_user) then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  return new;
end; $$;
create trigger trade_offers_block_insert before insert on public.trade_offers for each row execute function public.guard_blocked_trade();
create trigger trade_offers_block_accept before update of status on public.trade_offers for each row execute function public.guard_blocked_trade();

create function public.interaction_notification_actor(n public.notifications)
returns uuid language sql stable security definer set search_path='' as $$
  select case
    when n.type='auction_chat_mention' then n.actor_user_id
    when n.type='friend_request' then (select user_id from public.friendships where id=n.reference_id)
    when n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_cancelled') then (select from_user from public.trade_offers where id=n.reference_id)
    when n.type in ('trade_offer_accepted','trade_offer_declined') then (select to_user from public.trade_offers where id=n.reference_id)
  end
$$;

create function public.guard_blocked_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.users_blocked(new.user_id,public.interaction_notification_actor(new)) then return null; end if;
  return new;
end; $$;
create trigger notifications_block_interactions before insert or update on public.notifications
  for each row execute function public.guard_blocked_notification();

create function public.block_user(p_user_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_user_id is null or p_user_id=player_id or not exists(select 1 from public.user_profiles where user_id=p_user_id)
    then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  perform public.lock_social_pair(player_id,p_user_id);
  -- Required row order: friendship FOR UPDATE, then pending offers.
  perform 1 from public.friendships where (user_id=player_id and friend_id=p_user_id)
    or (user_id=p_user_id and friend_id=player_id) order by id for update;
  insert into public.user_blocks(blocker_id,blocked_id) values(player_id,p_user_id) on conflict do nothing;
  update public.trade_offers set status='cancelled',updated_at=clock_timestamp() where status='pending' and
    ((from_user=player_id and to_user=p_user_id) or (from_user=p_user_id and to_user=player_id));
  -- Resolve friend notification authors before deleting their source rows.
  delete from public.notifications n where n.user_id=player_id and public.interaction_notification_actor(n)=p_user_id;
  delete from public.friendships where (user_id=player_id and friend_id=p_user_id) or (user_id=p_user_id and friend_id=player_id);
  -- A fresh statement catches any insert validated before the friendship disappeared.
  update public.trade_offers set status='cancelled',updated_at=clock_timestamp() where status='pending' and
    ((from_user=player_id and to_user=p_user_id) or (from_user=p_user_id and to_user=player_id));
  -- No cancellation RPC: it would notify the other player.
  return true;
end; $$;

create function public.unblock_user(p_user_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_user_id is null or p_user_id=player_id then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  perform public.lock_social_pair(player_id,p_user_id);
  delete from public.user_blocks where blocker_id=player_id and blocked_id=p_user_id;
  return true;
end; $$;

create function public.list_blocked_users()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,'createdAt',b.created_at)
    order by b.created_at desc,p.user_id),'[]'::jsonb) from public.user_blocks b join public.user_profiles p on p.user_id=b.blocked_id where b.blocker_id=player_id);
end; $$;

create function public.report_user(p_user_id uuid,p_reason text,p_context_type text default 'profile',p_context_id uuid default null,p_details text default '',p_block_also boolean default false)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); content jsonb:='{}'; report_id uuid; day_start timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_user_id is null or p_user_id=player_id or not exists(select 1 from public.user_profiles where user_id=p_user_id)
    or p_reason is null or p_reason not in ('harassment','inappropriate','spam','cheating','other')
    or p_context_type is null or p_context_type not in ('profile','auction_chat')
    or char_length(coalesce(p_details,''))>500 or (p_context_type='profile' and p_context_id is not null)
    then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  if p_context_type='auction_chat' then
    select jsonb_build_object('message',left(m.message,500),'gifUrl',left(m.gif_url,1000))
      into content from public.auction_chat_messages m where m.id=p_context_id and m.user_id=p_user_id;
    if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('report:'||player_id::text,0));
  if exists(select 1 from public.user_reports where reporter_id=player_id and reported_id=p_user_id and context_type=p_context_type
    and context_id is not distinct from p_context_id) then raise exception 'REPORT_DUPLICATE' using errcode='P0001'; end if;
  if (select count(*) from public.user_reports where reporter_id=player_id and created_at>=day_start)>=10
    then raise exception 'REPORT_LIMIT' using errcode='P0001'; end if;
  insert into public.user_reports(reporter_id,reported_id,reason,context_type,context_id,snapshot,details)
    values(player_id,p_user_id,p_reason,p_context_type,p_context_id,content,coalesce(p_details,'')) returning id into report_id;
  if p_block_also then perform public.block_user(p_user_id); end if;
  return report_id;
end; $$;

create function public.admin_list_reports(p_status text default null,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is not null and p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb)
    from (select * from public.user_reports where p_status is null or status=p_status order by created_at desc,id desc
      limit least(greatest(coalesce(p_limit,50),1),100) offset greatest(coalesce(p_offset,0),0)) r);
end; $$;

create function public.admin_set_report_status(p_report_id uuid,p_status text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is null or p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  update public.user_reports set status=p_status where id=p_report_id;
  if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  return true;
end; $$;

revoke all on function public.users_blocked(uuid,uuid),public.lock_social_pair(uuid,uuid),public.guard_blocked_trade(),
  public.interaction_notification_actor(public.notifications),public.guard_blocked_notification(),
  public.block_user(uuid),public.unblock_user(uuid),public.list_blocked_users(),public.report_user(uuid,text,text,uuid,text,boolean),
  public.admin_list_reports(text,integer,integer),public.admin_set_report_status(uuid,text) from public,anon,authenticated;
grant execute on function public.block_user(uuid),public.unblock_user(uuid),public.list_blocked_users(),
  public.report_user(uuid,text,text,uuid,text,boolean),public.admin_list_reports(text,integer,integer),public.admin_set_report_status(uuid,text) to authenticated;

create or replace function public.get_auction_chat(p_auction_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); sale public.auctions%rowtype;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select * into sale from public.auctions where id=p_auction_id;
  if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  return jsonb_build_object(
    'canPost',sale.status='active' and (sale.seller_id=player_id or exists(select 1 from public.bids where auction_id=p_auction_id and bidder_id=player_id)),
    'participants',(select coalesce(jsonb_agg(jsonb_build_object('userId',participants.user_id,'pseudo',participants.pseudo,'avatarUrl',participants.avatar_url,'mine',participants.user_id=player_id) order by lower(participants.pseudo),participants.user_id),'[]'::jsonb)
      from (select p.user_id,p.pseudo,p.avatar_url from public.user_profiles p where p.user_id=sale.seller_id union select p.user_id,p.pseudo,p.avatar_url from public.bids b join public.user_profiles p on p.user_id=b.bidder_id where b.auction_id=p_auction_id) participants),
    'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'userId',m.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,'message',m.message,'gifUrl',m.gif_url,'createdAt',m.created_at,'mine',m.user_id=player_id) order by m.created_at,m.id),'[]'::jsonb)
      from (select * from public.auction_chat_messages where auction_id=p_auction_id and not exists(select 1 from public.user_blocks b where b.blocker_id=player_id and b.blocked_id=auction_chat_messages.user_id) order by created_at desc,id desc limit 100) m join public.user_profiles p on p.user_id=m.user_id)
  );
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
    from (select * from public.notifications where user_id=player_id and not public.users_blocked(player_id,public.interaction_notification_actor(notifications)) order by created_at desc limit safe_limit) n
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
