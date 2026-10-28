begin;

alter table public.user_reports drop constraint user_reports_context_type_check;
alter table public.user_reports drop constraint user_reports_check1;
alter table public.user_reports add constraint user_reports_context_type_check
  check(context_type in ('profile','auction_chat','wall_post','wall_reply'));
alter table public.user_reports add constraint user_reports_context_reference_check
  check((context_type='profile' and context_id is null) or (context_type in ('auction_chat','wall_post','wall_reply') and context_id is not null));

create or replace function public.report_user(p_user_id uuid,p_reason text,p_context_type text default 'profile',p_context_id uuid default null,p_details text default '',p_block_also boolean default false)
returns uuid language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare player_id uuid:=auth.uid(); content jsonb:='{}'; report_id uuid; day_start timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_user_id is null or p_user_id=player_id or not exists(select 1 from public.user_profiles where user_id=p_user_id)
    or p_reason is null or p_reason not in ('harassment','inappropriate','spam','cheating','other')
    or p_context_type is null or p_context_type not in ('profile','auction_chat','wall_post','wall_reply')
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
    where w.id=p_context_id and w.user_id=p_user_id and public.wall_actor_visible(player_id)
      and public.wall_actor_visible(w.user_id) for share of w;
    if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  elsif p_context_type='wall_reply' then
    select jsonb_build_object('message',r.body,'gifUrl',r.gif_url,'hasMedia',r.media_path is not null,
      'author',jsonb_build_object('id',p.user_id,'pseudo',p.pseudo),'createdAt',r.created_at,'postId',r.post_id)
    into content from public.wall_post_replies r join public.profile_wall_posts w on w.id=r.post_id
      join public.user_profiles p on p.user_id=r.user_id
    where r.id=p_context_id and r.user_id=p_user_id and public.wall_actor_visible(player_id)
      and public.wall_actor_visible(r.user_id) and public.wall_actor_visible(w.user_id)
      and (w.user_id=player_id or public.friendship_state(player_id,w.user_id)='accepted')
    for share of r,w;
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

-- Shared deletion mechanics. Public player RPCs retain their exact owner/ACL checks.
-- Only owning SECURITY DEFINER wrappers can execute this helper.
create function public.delete_wall_content_core(p_context_type text,p_context_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare item record; paths jsonb:='[]';
begin
  if p_context_type='wall_post' then
    select user_id,media_path into item from public.profile_wall_posts where id=p_context_id for update;
    if not found then return jsonb_build_object('alreadyDeleted',true,'mediaPaths','[]'::jsonb); end if;
    select coalesce(jsonb_agg(path),'[]'::jsonb) into paths from (
      select item.media_path path where item.media_path is not null
      union select media_path from public.wall_post_replies where post_id=p_context_id and media_path is not null
    ) files;
    delete from public.profile_wall_posts where id=p_context_id;
  elsif p_context_type='wall_reply' then
    select user_id,media_path into item from public.wall_post_replies where id=p_context_id for update;
    if not found then return jsonb_build_object('alreadyDeleted',true,'mediaPaths','[]'::jsonb); end if;
    if item.media_path is not null then paths:=jsonb_build_array(item.media_path); end if;
    delete from public.wall_post_replies where id=p_context_id;
  else raise exception 'REPORT_INVALID'; end if;
  return jsonb_build_object('alreadyDeleted',false,'mediaPaths',paths,'authorId',item.user_id,'mediaPath',item.media_path);
end; $$;

create or replace function public.delete_profile_wall_post(p_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_read_profile_wall(auth.uid()) then raise exception 'WALL_UNAVAILABLE'; end if;
  perform 1 from public.profile_wall_posts where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'WALL_POST_NOT_FOUND'; end if;
  result:=public.delete_wall_content_core('wall_post',p_id);
  return result->>'mediaPath';
end; $$;

create or replace function public.delete_wall_post_reply(p_post_id uuid,p_reply_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  perform public.wall_interaction_owner(p_post_id);
  perform 1 from public.wall_post_replies where id=p_reply_id and post_id=p_post_id and user_id=auth.uid() for update;
  if found then result:=public.delete_wall_content_core('wall_reply',p_reply_id); end if;
  return public.get_wall_post_activity(p_post_id) || jsonb_build_object('deletedMediaPath',result->>'mediaPath');
end; $$;

alter table public.admin_audit_logs drop constraint admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check(action in (
  'card.create','card.update','card.delete','card.import','card.bulk_delete',
  'player.ban','player.unban','player.card.remove','report.status.change','card_report.status.change','wall_content.delete'
));

create function public.admin_delete_reported_wall_content(p_report_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare report public.user_reports%rowtype; result jsonb; previous_paths jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  select * into report from public.user_reports where id=p_report_id for update;
  if not found or report.context_type not in ('wall_post','wall_reply') then raise exception 'REPORT_INVALID'; end if;
  result:=public.delete_wall_content_core(report.context_type,report.context_id);
  if (result->>'alreadyDeleted')::boolean then
    select metadata->'mediaPaths' into previous_paths from public.admin_audit_logs
      where action='wall_content.delete' and metadata->>'report_id'=p_report_id::text order by id desc limit 1;
    return result || jsonb_build_object('mediaPaths',coalesce(previous_paths,'[]'::jsonb));
  end if;
  if result->>'authorId'<>report.reported_id::text then raise exception 'REPORT_INVALID'; end if;
  insert into public.admin_audit_logs(admin_user_id,action,metadata)
    values(auth.uid(),'wall_content.delete',jsonb_build_object('report_id',p_report_id,'target_user_id',report.reported_id,
      'context_type',report.context_type,'context_id',report.context_id,'mediaPaths',result->'mediaPaths'));
  return result;
end; $$;

revoke all on function public.delete_wall_content_core(text,uuid),public.admin_delete_reported_wall_content(uuid),
  public.report_user(uuid,text,text,uuid,text,boolean),public.delete_profile_wall_post(uuid),public.delete_wall_post_reply(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_delete_reported_wall_content(uuid),public.report_user(uuid,text,text,uuid,text,boolean),
  public.delete_profile_wall_post(uuid),public.delete_wall_post_reply(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
