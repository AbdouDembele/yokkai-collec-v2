begin;
set local lock_timeout='3s';

-- Short-lived abuse controls: no request id, text, notification or recipient API.
-- Profile cascades erase both sides during prepare_account_deletion, before Auth.
create table public.friend_request_events (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  friend_id uuid not null references public.user_profiles(user_id) on delete cascade,
  kind text not null check(kind in ('sent','closed')),
  occurred_at timestamptz not null,
  primary key(user_id,friend_id,kind,occurred_at),
  check(user_id<>friend_id)
);
create index friend_request_events_sender_time on public.friend_request_events(user_id,occurred_at desc) where kind='sent';
create index friend_request_events_recipient on public.friend_request_events(friend_id);
create index friend_request_events_expiry on public.friend_request_events(occurred_at);
alter table public.friend_request_events enable row level security;
revoke all on table public.friend_request_events from public,anon,authenticated,service_role;
create trigger account_deletion_write_guard before insert or update or delete on public.friend_request_events
  for each statement execute function public.guard_deleted_account();
create trigger account_deletion_reference_guard before insert or update on public.friend_request_events
  for each row execute function public.guard_deleted_account();

-- Only still-existing recent sends can be recovered from the old schema.
insert into public.friend_request_events(user_id,friend_id,kind,occurred_at)
select user_id,friend_id,'sent',created_at from public.friendships
where created_at>clock_timestamp()-interval '24 hours' on conflict do nothing;
select cron.schedule('purge-friend-request-events','17 * * * *',
  $$delete from public.friend_request_events where occurred_at<=clock_timestamp()-interval '24 hours'$$);

-- Account fences must precede friendship/event row locks: cancellation now
-- inserts a trace referencing both profiles after deleting the request row.
create function public.lock_friend_request_pair(p_first uuid,p_second uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare player uuid;
begin
  for player in select distinct id from unnest(array[p_first,p_second]) ids(id) order by id loop
    perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||player::text,0));
  end loop;
  perform public.lock_social_pair(p_first,p_second);
end; $$;
revoke all on function public.lock_friend_request_pair(uuid,uuid) from public,anon,authenticated,service_role;

-- Dismiss only the notification belonging to this resolved pending request.
create function public.dismiss_friend_request_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='pending' and (tg_op='DELETE' or new.status<>'pending') then
    delete from public.notifications where user_id=old.friend_id and type='friend_request' and reference_id=old.id;
  end if;
  return null;
end; $$;
revoke all on function public.dismiss_friend_request_notification() from public,anon,authenticated,service_role;
create trigger friendships_dismiss_notification after update of status or delete on public.friendships
  for each row execute function public.dismiss_friend_request_notification();
-- Remove legacy orphan/accepted request notifications, leaving other types alone.
delete from public.notifications n where n.type='friend_request' and not exists(
  select 1 from public.friendships f where f.id=n.reference_id and f.friend_id=n.user_id and f.status='pending');

create or replace function public.send_friend_request(p_friend_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); request_id uuid; checked_at timestamptz;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_friend_id is null or p_friend_id=player_id then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  perform public.lock_friend_request_pair(player_id,p_friend_id);
  -- Blocking must remain indistinguishable from an unavailable target, even at quota.
  if public.users_blocked(player_id,p_friend_id) or not exists(select 1 from public.user_profiles where user_id=p_friend_id)
    then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  if exists(select 1 from public.account_deletion_log where user_id in(player_id,p_friend_id)) then
    raise exception 'ACCOUNT_DELETED' using errcode='P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('friend-request-sender:'||player_id::text,0));
  checked_at:=clock_timestamp();
  if exists(select 1 from public.friendships where (user_id=player_id and friend_id=p_friend_id)
    or (user_id=p_friend_id and friend_id=player_id)) then raise exception 'FRIENDSHIP_EXISTS' using errcode='P0001'; end if;
  delete from public.friend_request_events where user_id=player_id and occurred_at<=checked_at-interval '24 hours';
  if exists(select 1 from public.friend_request_events where user_id=player_id and friend_id=p_friend_id
    and kind='closed' and occurred_at>checked_at-interval '24 hours') then
    raise exception 'FRIEND_REQUEST_COOLDOWN' using errcode='P0001'; end if;
  if (select count(*) from public.friend_request_events where user_id=player_id and kind='sent'
    and occurred_at>checked_at-interval '24 hours')>=30 then
    raise exception 'FRIEND_REQUEST_LIMIT' using errcode='P0001'; end if;
  insert into public.friendships(user_id,friend_id) values(player_id,p_friend_id) returning id into request_id;
  insert into public.friend_request_events values(player_id,p_friend_id,'sent',clock_timestamp());
  return request_id;
exception when unique_violation then raise exception 'FRIENDSHIP_EXISTS' using errcode='P0001';
end; $$;

create or replace function public.cancel_friend_request(p_friend_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_friend_id is null or p_friend_id=player_id then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  perform public.lock_friend_request_pair(player_id,p_friend_id);
  if public.users_blocked(player_id,p_friend_id) then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  delete from public.friendships where user_id=player_id and friend_id=p_friend_id and status='pending';
  if not found then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  insert into public.friend_request_events values(player_id,p_friend_id,'closed',clock_timestamp());
  return true;
end; $$;

create or replace function public.respond_friend_request(p_request_id uuid,p_accept boolean)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); sender_id uuid;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select user_id into sender_id from public.friendships where id=p_request_id and friend_id=player_id and status='pending';
  if not found or p_accept is null then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  perform public.lock_friend_request_pair(player_id,sender_id);
  if public.users_blocked(player_id,sender_id) then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  if p_accept then
    update public.friendships set status='accepted',updated_at=clock_timestamp()
      where id=p_request_id and friend_id=player_id and status='pending';
    if not found then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
    -- A mutually accepted relationship supersedes an earlier refusal in either direction.
    delete from public.friend_request_events where kind='closed' and
      ((user_id=sender_id and friend_id=player_id) or (user_id=player_id and friend_id=sender_id));
  else
    delete from public.friendships where id=p_request_id and friend_id=player_id and status='pending';
    if not found then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
    insert into public.friend_request_events values(sender_id,player_id,'closed',clock_timestamp());
  end if;
  return p_accept;
end; $$;

revoke all on function public.send_friend_request(uuid),public.cancel_friend_request(uuid),public.respond_friend_request(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.send_friend_request(uuid),public.cancel_friend_request(uuid),public.respond_friend_request(uuid,boolean) to authenticated;

-- Keep the current export body and its service-only reservation gate in one snapshot.
create or replace function public.build_data_export(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  select public.build_data_export_without_binders(p_user_id,p_request_id) || jsonb_build_object(
    'binder_favorite_preferences',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by binder_key)
      from public.binder_favorite_preferences t where user_id=p_user_id),'[]'::jsonb),
    'binder_legacy_favorite_resolutions',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by license)
      from public.binder_legacy_favorite_resolutions t where user_id=p_user_id),'[]'::jsonb),
    'binder_profile_widgets',coalesce((select widgets from public.binder_profile_widgets where user_id=p_user_id),'[]'::jsonb),
    'friend_request_events',coalesce((select jsonb_agg(value order by value->>'occurred_at') from (
      select jsonb_build_object('kind',e.kind,'occurred_at',e.occurred_at,
        'recipient',jsonb_build_object('pseudo',p.pseudo)) value
      from public.friend_request_events e join public.user_profiles p on p.user_id=e.friend_id
      where e.user_id=p_user_id and e.occurred_at>statement_timestamp()-interval '24 hours' limit 100001
    ) own_events),'[]'::jsonb)
  ) into result;
  if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
      when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result))>100000
    or octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
  return result;
end; $$;
revoke all on function public.build_data_export(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.build_data_export(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
