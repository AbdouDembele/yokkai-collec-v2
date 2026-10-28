begin;

-- Delivery order is independent of wall-clock adjustments. Sends already hold
-- lock_social_pair before insertion, so a pair cannot commit out of order.
create sequence public.private_message_read_order_seq;
alter table public.private_messages add column read_order bigint;
with ordered as (
  select id,row_number() over(order by created_at,id) n from public.private_messages
) update public.private_messages m set read_order=o.n from ordered o where o.id=m.id;
select pg_catalog.setval('public.private_message_read_order_seq',
  greatest(1,coalesce(max(read_order),0)),count(*)>0) from public.private_messages;
alter table public.private_messages alter column read_order set default nextval('public.private_message_read_order_seq');
alter table public.private_messages alter column read_order set not null;
alter sequence public.private_message_read_order_seq owned by public.private_messages.read_order;
revoke all on sequence public.private_message_read_order_seq from public,anon,authenticated;
grant all on sequence public.private_message_read_order_seq to service_role;
create unique index private_messages_read_order_idx on public.private_messages(read_order);
create index private_messages_unread_idx on public.private_messages(recipient_id,sender_id,read_order);

create table public.private_message_reads (
  viewer_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  last_read_order bigint not null check(last_read_order>0),
  primary key(viewer_id,friend_id), check(viewer_id<>friend_id)
);
create index private_message_reads_friend_idx on public.private_message_reads(friend_id);
alter table public.private_message_reads enable row level security;
revoke all on table public.private_message_reads from public,anon,authenticated;
grant all on table public.private_message_reads to service_role;
create trigger account_deletion_write_guard before insert or update or delete on public.private_message_reads
  for each statement execute function public.guard_deleted_account();

create function public.get_social_unread()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  with senders as materialized (
    select distinct sender_id from public.private_messages where recipient_id=viewer
  ), allowed as materialized (
    select sender_id from senders where public.private_messaging_allowed(viewer,sender_id)
  ), unread as (
    select a.sender_id,count(*) n from allowed a
    left join public.private_message_reads r on r.viewer_id=viewer and r.friend_id=a.sender_id
    join public.private_messages m on m.recipient_id=viewer and m.sender_id=a.sender_id
      and m.read_order>coalesce(r.last_read_order,0)
    group by a.sender_id
  )
  select jsonb_build_object('viewerId',viewer,
    'messages',coalesce((select jsonb_agg(jsonb_build_object('friendId',sender_id,'count',n) order by sender_id) from unread),'[]'::jsonb),
    'messageCount',coalesce((select sum(n) from unread),0),
    'requestCount',(select count(*) from public.friendships f
      join public.user_profiles p on p.user_id=f.user_id
      join auth.users u on u.id=f.user_id
      join auth.users v on v.id=viewer
      where f.friend_id=viewer and f.status='pending'
        and (u.banned_until is null or u.banned_until<=now())
        and (v.banned_until is null or v.banned_until<=now())
        and not public.users_blocked(viewer,f.user_id)
        and not exists(select 1 from public.account_deletion_log where user_id in (viewer,f.user_id)))) into result;
  return result;
end; $$;
revoke all on function public.get_social_unread() from public,anon;
grant execute on function public.get_social_unread() to authenticated;

create function public.mark_private_messages_read(p_friend_id uuid,p_last_message_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); delivery bigint;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_friend_id is null or p_friend_id=viewer then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||least(viewer,p_friend_id)::text,0));
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||greatest(viewer,p_friend_id)::text,0));
  perform public.lock_social_pair(viewer,p_friend_id);
  if not public.private_messaging_allowed(viewer,p_friend_id) then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  select read_order into delivery from public.private_messages
    where id=p_last_message_id and sender_id=p_friend_id and recipient_id=viewer;
  if delivery is null then raise exception 'MESSAGE_READ_INVALID'; end if;
  insert into public.private_message_reads(viewer_id,friend_id,last_read_order) values(viewer,p_friend_id,delivery)
    on conflict(viewer_id,friend_id) do update
    set last_read_order=greatest(private_message_reads.last_read_order,excluded.last_read_order);
  return true;
end; $$;
revoke all on function public.mark_private_messages_read(uuid,uuid) from public,anon;
grant execute on function public.mark_private_messages_read(uuid,uuid) to authenticated;

-- Reading a page does not acknowledge it. The visible conversation explicitly
-- acknowledges only the last incoming message returned in that page.
create or replace function public.get_private_messages(
  p_friend_id uuid,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 40
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); page_size integer:=least(100,greatest(1,coalesce(p_limit,40))); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.private_messaging_allowed(viewer,p_friend_id) then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'MESSAGE_CURSOR_INVALID'; end if;
  with page as materialized (
    select m.* from public.private_messages m
    where m.pair_low=least(viewer,p_friend_id) and m.pair_high=greatest(viewer,p_friend_id)
      and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
    order by m.created_at desc,m.id desc limit page_size+1
  ), visible as (select * from page order by created_at desc,id desc limit page_size)
  select jsonb_build_object('viewerId',viewer,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'senderId',sender_id,'recipientId',recipient_id,
      'text',body,'createdAt',created_at,'gifUrl',gif_url) order by created_at,id) from visible),'[]'::jsonb),
    'readThroughId',(select id from visible where recipient_id=viewer order by read_order desc limit 1),
    'next',case when (select count(*) from page)>page_size then
      (select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1) else null end
  ) into result;
  return result;
end; $$;

commit;
