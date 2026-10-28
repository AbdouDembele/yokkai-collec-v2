-- First production version follows the coordinated PERF/ENG migrations.
begin;

create table public.private_messages (
  id uuid primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000 and body !~ '^[[:space:]]*$'),
  created_at timestamptz not null default clock_timestamp(),
  pair_low uuid generated always as (least(sender_id,recipient_id)) stored,
  pair_high uuid generated always as (greatest(sender_id,recipient_id)) stored,
  check (sender_id<>recipient_id)
);
create index private_messages_pair_page_idx
  on public.private_messages(pair_low,pair_high,created_at desc,id desc);
create index private_messages_sender_rate_idx on public.private_messages(sender_id,created_at desc);
create index private_messages_recipient_idx on public.private_messages(recipient_id);
alter table public.private_messages enable row level security;
revoke all on table public.private_messages from public,anon,authenticated;
grant all on table public.private_messages to service_role;
create trigger account_deletion_write_guard before insert or update or delete on public.private_messages
  for each statement execute function public.guard_deleted_account();

-- Owner-only predicate: the caller is always supplied from auth.uid() by the RPCs.
create function public.private_messaging_allowed(p_viewer uuid,p_friend uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  return (select p_viewer is not null and p_friend is not null and p_viewer<>p_friend
    and not public.users_blocked(p_viewer,p_friend)
    and not exists(select 1 from public.account_deletion_log where user_id in (p_viewer,p_friend))
    and exists(select 1 from public.friendships f where f.status='accepted'
      and least(f.user_id,f.friend_id)=least(p_viewer,p_friend)
      and greatest(f.user_id,f.friend_id)=greatest(p_viewer,p_friend))
    and (select count(*)=2 from public.user_profiles p join auth.users u on u.id=p.user_id
      where p.user_id in (p_viewer,p_friend) and (u.banned_until is null or u.banned_until<=now())));
end;
$$;
revoke all on function public.private_messaging_allowed(uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_private_messages(
  p_friend_id uuid,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 40
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  viewer uuid:=auth.uid();
  page_size integer:=least(100,greatest(1,coalesce(p_limit,40)));
  result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not public.private_messaging_allowed(viewer,p_friend_id) then
    raise exception 'MESSAGES_UNAVAILABLE' using errcode='P0001';
  end if;
  if (p_before is null)<>(p_before_id is null) then
    raise exception 'MESSAGE_CURSOR_INVALID' using errcode='P0001';
  end if;
  with page as materialized (
    select m.* from public.private_messages m
    where m.pair_low=least(viewer,p_friend_id) and m.pair_high=greatest(viewer,p_friend_id)
      and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
    order by m.created_at desc,m.id desc limit page_size+1
  ), visible as (
    select * from page order by created_at desc,id desc limit page_size
  )
  select jsonb_build_object(
    'viewerId',viewer,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'senderId',sender_id,'recipientId',recipient_id,'text',body,'createdAt',created_at
    ) order by created_at,id) from visible),'[]'::jsonb),
    'next',case when (select count(*) from page)>page_size then
      (select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1)
      else null end
  ) into result;
  return result;
end; $$;
revoke all on function public.get_private_messages(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_private_messages(uuid,timestamptz,uuid,integer) to authenticated;

create function public.send_private_message(p_friend_id uuid,p_body text,p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  viewer uuid:=auth.uid();
  content text:=btrim(p_body);
  message public.private_messages;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_friend_id is null or p_friend_id=viewer then
    raise exception 'MESSAGES_UNAVAILABLE' using errcode='P0001';
  end if;
  -- Shared with block/unblock and friendship mutations, so sending cannot bypass a concurrent block.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||least(viewer,p_friend_id)::text,0));
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||greatest(viewer,p_friend_id)::text,0));
  perform public.lock_social_pair(viewer,p_friend_id);
  if not public.private_messaging_allowed(viewer,p_friend_id) then
    raise exception 'MESSAGES_UNAVAILABLE' using errcode='P0001';
  end if;
  if p_id is null or content is null or char_length(content) not between 1 and 2000 or content~'^[[:space:]]*$' then
    raise exception 'MESSAGE_INVALID' using errcode='P0001';
  end if;
  -- Serialize a sender across all recipients, including retries from another tab.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('private-messages:'||viewer::text,0));
  select * into message from public.private_messages where id=p_id;
  if found then
    if message.sender_id<>viewer or message.recipient_id<>p_friend_id or message.body<>content then
      raise exception 'MESSAGE_CONFLICT' using errcode='P0001';
    end if;
  else
    if exists(select 1 from public.private_messages where sender_id=viewer and created_at>clock_timestamp()-interval '1 second')
      or (select count(*) from public.private_messages where sender_id=viewer and created_at>clock_timestamp()-interval '1 minute')>=30 then
      raise exception 'MESSAGE_RATE_LIMITED' using errcode='P0001';
    end if;
    insert into public.private_messages(id,sender_id,recipient_id,body)
      values(p_id,viewer,p_friend_id,content) returning * into message;
  end if;
  return jsonb_build_object('id',message.id,'senderId',message.sender_id,
    'recipientId',message.recipient_id,'text',message.body,'createdAt',message.created_at);
end; $$;
revoke all on function public.send_private_message(uuid,text,uuid) from public,anon;
grant execute on function public.send_private_message(uuid,text,uuid) to authenticated;

commit;
