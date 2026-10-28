-- First production version follows the coordinated PERF/ENG migrations.
begin;

-- No gallery upload or storage bucket: messaging only accepts GIPHY GIF URLs.
alter table public.private_messages add column gif_url text;
alter table public.private_messages drop constraint private_messages_body_check;
alter table public.private_messages add constraint private_messages_content_check check (
  char_length(body)<=2000 and (body !~ '^[[:space:]]*$' or gif_url is not null)
  and (gif_url is null or (char_length(gif_url)<=2048
    and gif_url ~ '^https://(media[0-9]*|i)\.giphy\.com/media/[A-Za-z0-9/_.-]+\.gif(\?[A-Za-z0-9_=&%.-]+)?$'))
);

create function public.send_private_message_gif(p_friend_id uuid,p_body text,p_id uuid,p_gif_url text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); content text:=btrim(p_body); message public.private_messages;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_friend_id is null or p_friend_id=viewer then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||least(viewer,p_friend_id)::text,0));
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||greatest(viewer,p_friend_id)::text,0));
  perform public.lock_social_pair(viewer,p_friend_id);
  if not public.private_messaging_allowed(viewer,p_friend_id) then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  if p_id is null or content is null or char_length(content)>2000
    or (content~'^[[:space:]]*$' and p_gif_url is null) then raise exception 'MESSAGE_INVALID'; end if;
  if p_gif_url is not null and (char_length(p_gif_url)>2048 or
    p_gif_url !~ '^https://(media[0-9]*|i)\.giphy\.com/media/[A-Za-z0-9/_.-]+\.gif(\?[A-Za-z0-9_=&%.-]+)?$') then raise exception 'MESSAGE_GIF_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('private-messages:'||viewer::text,0));
  select * into message from public.private_messages where id=p_id;
  if found then
    if message.sender_id<>viewer or message.recipient_id<>p_friend_id or message.body<>content
      or message.gif_url is distinct from p_gif_url then raise exception 'MESSAGE_CONFLICT'; end if;
  else
    if exists(select 1 from public.private_messages where sender_id=viewer and created_at>clock_timestamp()-interval '1 second')
      or (select count(*) from public.private_messages where sender_id=viewer and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'MESSAGE_RATE_LIMITED'; end if;
    insert into public.private_messages(id,sender_id,recipient_id,body,gif_url)
      values(p_id,viewer,p_friend_id,content,p_gif_url) returning * into message;
  end if;
  return jsonb_build_object('id',message.id,'senderId',message.sender_id,'recipientId',message.recipient_id,
    'text',message.body,'createdAt',message.created_at,'gifUrl',message.gif_url);
end; $$;
revoke all on function public.send_private_message_gif(uuid,text,uuid,text) from public,anon;
grant execute on function public.send_private_message_gif(uuid,text,uuid,text) to authenticated;

-- Keep the existing text API and its guarantees; all sends share the same rate lock.
create or replace function public.send_private_message(p_friend_id uuid,p_body text,p_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  select public.send_private_message_gif(p_friend_id,p_body,p_id,null)
$$;

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
    'next',case when (select count(*) from page)>page_size then
      (select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1) else null end
  ) into result;
  return result;
end; $$;

commit;
