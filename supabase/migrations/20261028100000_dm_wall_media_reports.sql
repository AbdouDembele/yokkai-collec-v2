-- #379 (C1): report private messages, show reported wall media to admins, and
-- let admins hide a DM or a wall media item for everyone, with an audit entry.
begin;

-- A hidden DM keeps its row (thread order, read state) with no content left.
alter table public.private_messages add column moderated_at timestamptz;
alter table public.private_messages drop constraint private_messages_content_check;
alter table public.private_messages add constraint private_messages_content_check check(
  (moderated_at is not null and body='' and gif_url is null)
  or (char_length(body)<=2000 and (body !~ '^[[:space:]]*$' or gif_url is not null)
    and (gif_url is null or (char_length(gif_url)<=2048
      and gif_url ~ '^https://(media[0-9]*|i)\.giphy\.com/media/[A-Za-z0-9/_.-]+\.gif(\?[A-Za-z0-9_=&%.-]+)?$'))));

alter table public.user_reports drop constraint user_reports_context_type_check;
alter table public.user_reports drop constraint user_reports_context_reference_check;
alter table public.user_reports add constraint user_reports_context_type_check
  check(context_type in ('profile','auction_chat','wall_post','wall_reply','private_message'));
alter table public.user_reports add constraint user_reports_context_reference_check
  check((context_type='profile' and context_id is null)
    or (context_type in ('auction_chat','wall_post','wall_reply','private_message') and context_id is not null));

-- Existing limits apply to every context: one report per player and item,
-- 10 reports per reporter and UTC day.
create or replace function public.report_user(p_user_id uuid,p_reason text,p_context_type text default 'profile',p_context_id uuid default null,p_details text default '',p_block_also boolean default false)
returns uuid language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare player_id uuid:=auth.uid(); content jsonb:='{}'; report_id uuid; day_start timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_user_id is null or p_user_id=player_id or not exists(select 1 from public.user_profiles where user_id=p_user_id)
    or p_reason is null or p_reason not in ('harassment','inappropriate','spam','cheating','other')
    or p_context_type is null or p_context_type not in ('profile','auction_chat','wall_post','wall_reply','private_message')
    or char_length(coalesce(p_details,''))>500 or (p_context_type='profile' and p_context_id is not null)
    then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  if p_context_type='auction_chat' then
    select jsonb_build_object('message',left(m.message,500),'gifUrl',left(m.gif_url,1000))
      into content from public.auction_chat_messages m where m.id=p_context_id and m.user_id=p_user_id;
    if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  elsif p_context_type='wall_post' then
    select jsonb_build_object('message',w.body,'gifUrl',w.gif_url,'hasMedia',w.media_path is not null,
      'author',jsonb_build_object('id',p.user_id,'pseudo',p.pseudo),'createdAt',w.created_at)
    into content from public.profile_wall_posts w join public.user_profiles p on p.user_id=w.user_id
    where w.id=p_context_id and w.user_id=p_user_id and public.wall_post_interaction_allowed(player_id,w.id) for share of w;
    if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  elsif p_context_type='wall_reply' then
    select jsonb_build_object('message',r.body,'gifUrl',r.gif_url,'hasMedia',r.media_path is not null,
      'author',jsonb_build_object('id',p.user_id,'pseudo',p.pseudo),'createdAt',r.created_at,'postId',r.post_id)
    into content from public.wall_post_replies r join public.profile_wall_posts w on w.id=r.post_id
      join public.user_profiles p on p.user_id=r.user_id
    where r.id=p_context_id and r.user_id=p_user_id and public.wall_actor_visible(player_id)
      and public.wall_reply_author_visible(r.user_id) and public.wall_post_interaction_allowed(player_id,w.id)
    for share of r,w;
    if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  elsif p_context_type='private_message' then
    -- Only the recipient of a visible conversation; the snapshot is the content only.
    select jsonb_build_object('message',m.body,'gifUrl',m.gif_url)
    into content from public.private_messages m
    where m.id=p_context_id and m.sender_id=p_user_id and m.recipient_id=player_id and m.moderated_at is null
      and public.private_messaging_allowed(player_id,p_user_id)
    for share of m;
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

create or replace function public.get_private_messages(p_friend_id uuid,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 40)
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
      'text',body,'createdAt',created_at,'gifUrl',gif_url,'moderated',moderated_at is not null) order by created_at,id) from visible),'[]'::jsonb),
    'readThroughId',(select id from visible where recipient_id=viewer order by read_order desc limit 1),
    'next',case when (select count(*) from page)>page_size then
      (select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1) else null end
  ) into result;
  return result;
end; $$;

alter table public.admin_audit_logs drop constraint admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check(action in (
  'card.create','card.update','card.delete','card.import','card.bulk_delete',
  'player.ban','player.unban','player.card.remove','report.status.change','card_report.status.change','wall_content.delete',
  'private_message.moderate','wall_media.moderate'
));

-- Admin removal for everyone: a DM loses its text and GIF; a wall post or reply
-- loses only its image or GIF and keeps its text. Codes: ADMIN_REQUIRED,
-- REPORT_INVALID, MODERATION_TEXT_REQUIRED (no text left: delete the content).
create function public.admin_moderate_reported_content(p_report_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare report public.user_reports%rowtype; item record; paths jsonb:='[]'; previous_paths jsonb;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  select * into report from public.user_reports where id=p_report_id for update;
  if not found or report.context_type not in ('private_message','wall_post','wall_reply')
    then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  if report.context_type='private_message' then
    select sender_id author_id,moderated_at into item from public.private_messages where id=report.context_id for update;
    if not found or item.moderated_at is not null then
      return jsonb_build_object('alreadyRemoved',true,'mediaPaths','[]'::jsonb); end if;
    if item.author_id is distinct from report.reported_id then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
    update public.private_messages set body='',gif_url=null,moderated_at=clock_timestamp() where id=report.context_id;
  else
    if report.context_type='wall_post' then
      select user_id author_id,body,media_path,gif_url into item from public.profile_wall_posts where id=report.context_id for update;
    else
      select user_id author_id,body,media_path,gif_url into item from public.wall_post_replies where id=report.context_id for update;
    end if;
    if not found or (item.media_path is null and item.gif_url is null) then
      select metadata->'mediaPaths' into previous_paths from public.admin_audit_logs
        where action='wall_media.moderate' and metadata->>'report_id'=p_report_id::text order by id desc limit 1;
      return jsonb_build_object('alreadyRemoved',true,'mediaPaths',coalesce(previous_paths,'[]'::jsonb));
    end if;
    if item.author_id is distinct from report.reported_id then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
    if btrim(item.body)='' then raise exception 'MODERATION_TEXT_REQUIRED' using errcode='P0001'; end if;
    if item.media_path is not null then paths:=jsonb_build_array(item.media_path); end if;
    -- Same cleanup receipt as content deletion: the server removes the object next.
    insert into public.wall_reply_media_cleanup(media_path,user_id,object_id,content_type,content_id,created_at)
      select o.name,auth.uid(),to_jsonb(o)->>'id',report.context_type,report.context_id,now()
      from storage.objects o where o.bucket_id='profile-wall-media' and o.name=item.media_path
        and to_jsonb(o)->>'id' is not null
      on conflict(media_path) do update set user_id=excluded.user_id,object_id=excluded.object_id,
        content_type=excluded.content_type,content_id=excluded.content_id,created_at=excluded.created_at;
    if report.context_type='wall_post' then
      update public.profile_wall_posts set media_path=null,gif_url=null where id=report.context_id;
    else
      update public.wall_post_replies set media_path=null,gif_url=null where id=report.context_id;
    end if;
  end if;
  insert into public.admin_audit_logs(admin_user_id,action,metadata)
    values(auth.uid(),case when report.context_type='private_message' then 'private_message.moderate' else 'wall_media.moderate' end,
      jsonb_build_object('report_id',p_report_id,'target_user_id',report.reported_id,
        'context_type',report.context_type,'context_id',report.context_id,'mediaPaths',paths));
  return jsonb_build_object('alreadyRemoved',false,'mediaPaths',paths);
end; $$;

-- Current uploaded image of a reported wall item, for the admin preview route.
create function public.admin_get_reported_wall_media(p_report_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare report public.user_reports%rowtype;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  select * into report from public.user_reports where id=p_report_id;
  if not found or report.context_type not in ('wall_post','wall_reply') then return null; end if;
  if report.context_type='wall_post' then
    return (select media_path from public.profile_wall_posts where id=report.context_id and user_id=report.reported_id);
  end if;
  return (select media_path from public.wall_post_replies where id=report.context_id and user_id=report.reported_id);
end; $$;

revoke all on function public.report_user(uuid,text,text,uuid,text,boolean),
  public.get_private_messages(uuid,timestamptz,uuid,integer),
  public.admin_moderate_reported_content(uuid),public.admin_get_reported_wall_media(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.report_user(uuid,text,text,uuid,text,boolean),
  public.get_private_messages(uuid,timestamptz,uuid,integer),
  public.admin_moderate_reported_content(uuid),public.admin_get_reported_wall_media(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
