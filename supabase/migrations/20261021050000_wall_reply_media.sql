begin;

alter table public.wall_post_replies
  add column media_path text unique,
  add column gif_url text,
  drop constraint wall_post_replies_body_check,
  add constraint wall_reply_content check (
    char_length(body)<=1000 and (btrim(body)<>'' or media_path is not null or gif_url is not null)),
  add constraint wall_reply_attachment check (media_path is null or gif_url is null),
  add constraint wall_reply_media_path check (media_path is null or
    (split_part(media_path,'/',1)=user_id::text and media_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$')),
  add constraint wall_reply_gif check (gif_url is null or
    (char_length(gif_url)<=1000 and gif_url ~ '^https://(media[0-9]*|i)\.giphy\.com/'));

-- One file, one audience. Serialize bindings across posts AND replies so a
-- previously uploaded image cannot be reused to expose a private conversation.
create function public.guard_wall_media_binding() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.media_path is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('wall-media-binding:'||new.media_path,0));
  -- Publication RPCs validate file existence. Lock an existing object against
  -- concurrent deletion, without rejecting owner-maintained historical rows.
  perform 1 from storage.objects where bucket_id='profile-wall-media' and name=new.media_path for update;
  if exists(select 1 from public.profile_wall_posts where media_path=new.media_path
      and (tg_table_name<>'profile_wall_posts' or id<>new.id))
    or exists(select 1 from public.wall_post_replies where media_path=new.media_path
      and (tg_table_name<>'wall_post_replies' or id<>new.id)) then raise exception 'WALL_MEDIA_INVALID'; end if;
  return new;
end; $$;
revoke all on function public.guard_wall_media_binding() from public,anon,authenticated,service_role;
create trigger wall_post_media_binding before insert or update of media_path on public.profile_wall_posts
  for each row execute function public.guard_wall_media_binding();
create trigger wall_reply_media_binding before insert or update of media_path on public.wall_post_replies
  for each row execute function public.guard_wall_media_binding();

-- No SELECT grant on replies. This narrow policy helper only answers whether
-- this caller may read a bound file, or delete their own unreferenced upload.
create function public.wall_reply_media_access(p_path text,p_delete boolean) returns boolean
language sql stable security definer set search_path='' as $$
  select public.wall_actor_visible(auth.uid()) and case when p_delete then
    split_part(p_path,'/',1)=auth.uid()::text
      and not exists(select 1 from public.wall_post_replies where media_path=p_path)
  else exists(select 1 from public.wall_post_replies r
    join public.profile_wall_posts p on p.id=r.post_id
    where r.media_path=p_path and public.wall_actor_visible(r.user_id)
      and public.wall_actor_visible(p.user_id)
      and (p.user_id=auth.uid() or exists(select 1 from public.friendships f where f.status='accepted'
        and ((f.user_id=auth.uid() and f.friend_id=p.user_id) or (f.friend_id=auth.uid() and f.user_id=p.user_id))))) end
$$;
revoke all on function public.wall_reply_media_access(text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.wall_reply_media_access(text,boolean) to authenticated;
alter policy profile_wall_media_read on storage.objects using (
  bucket_id='profile-wall-media' and (
    (split_part(name,'/',1)=auth.uid()::text and public.can_read_profile_wall(auth.uid()))
    or exists(select 1 from public.profile_wall_posts p where p.media_path=name and public.can_read_profile_wall(p.user_id))
    or public.wall_reply_media_access(name,false)));
alter policy profile_wall_media_delete on storage.objects using (
  bucket_id='profile-wall-media' and split_part(name,'/',1)=auth.uid()::text
  and public.can_read_profile_wall(auth.uid())
  and not exists(select 1 from public.profile_wall_posts p where p.media_path=name)
  and public.wall_reply_media_access(name,true));

create function public.get_wall_reply_media(p_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare item public.wall_post_replies%rowtype;
begin
  select * into item from public.wall_post_replies where id=p_id;
  if not found then raise exception 'WALL_POST_UNAVAILABLE'; end if;
  perform public.wall_interaction_owner(item.post_id);
  if not public.wall_actor_visible(item.user_id) then raise exception 'WALL_POST_UNAVAILABLE'; end if;
  return item.media_path;
end; $$;
revoke all on function public.get_wall_reply_media(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_wall_reply_media(uuid) to authenticated;

create or replace function public.get_wall_post_activity_without_reactions(p_post_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.wall_interaction_owner(p_post_id);
  if (p_before is null)<>(p_before_id is null) then raise exception 'WALL_CURSOR_INVALID'; end if;
  with page as materialized (
    select r.*,p.pseudo,p.avatar_url,row_number() over(order by r.created_at desc,r.id desc) n
    from public.wall_post_replies r join public.user_profiles p on p.user_id=r.user_id
    where r.post_id=p_post_id and public.wall_actor_visible(r.user_id)
      and (p_before is null or (r.created_at,r.id)<(p_before,p_before_id))
    order by r.created_at desc,r.id desc limit 11
  ) select jsonb_build_object(
    'likes',(select count(*) from public.wall_post_likes l where l.post_id=p_post_id and public.wall_actor_visible(l.user_id)),
    'likedByMe',exists(select 1 from public.wall_post_likes where post_id=p_post_id and user_id=auth.uid()),
    'replyCount',(select count(*) from public.wall_post_replies r where r.post_id=p_post_id and public.wall_actor_visible(r.user_id)),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',body,'createdAt',created_at,'isMe',user_id=auth.uid(),
      'hasMedia',media_path is not null,'mediaPath',case when user_id=auth.uid() then media_path else null end,'gifUrl',gif_url,
      'author',jsonb_build_object('id',user_id,'name',pseudo,'avatarUrl',avatar_url)) order by created_at desc,id desc)
      from page where n<=10),'[]'::jsonb),
    'next',case when exists(select 1 from page where n=11) then
      (select jsonb_build_object('at',created_at,'id',id) from page where n=10) else null end
  ) into result;
  return result;
end; $$;

create function public.publish_wall_post_reply_media(p_post_id uuid,p_id uuid,p_body text,p_media_path text,p_gif_url text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare clean_body text:=btrim(coalesce(p_body,'')); item public.wall_post_replies%rowtype;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  perform pg_advisory_xact_lock(hashtextextended('wall-interactions:'||auth.uid()::text,0));
  perform public.wall_interaction_owner(p_post_id);
  if p_id is null or char_length(clean_body)>1000 or (clean_body='' and p_media_path is null and p_gif_url is null)
    or (p_media_path is not null and p_gif_url is not null) then raise exception 'WALL_REPLY_INVALID'; end if;
  if p_gif_url is not null and (char_length(p_gif_url)>1000 or p_gif_url !~ '^https://(media[0-9]*|i)\.giphy\.com/')
    then raise exception 'WALL_GIF_INVALID'; end if;
  select * into item from public.wall_post_replies where id=p_id;
  if found then
    if item.post_id<>p_post_id or item.user_id<>auth.uid() or item.body<>clean_body
      or item.media_path is distinct from p_media_path or item.gif_url is distinct from p_gif_url then raise exception 'WALL_REPLY_INVALID'; end if;
    return public.get_wall_post_activity(p_post_id);
  end if;
  if (select count(*) from public.wall_post_replies where user_id=auth.uid() and created_at>now()-interval '1 hour')>=30
    or exists(select 1 from public.wall_post_replies where user_id=auth.uid() and created_at>clock_timestamp()-interval '5 seconds')
    then raise exception 'WALL_REPLY_RATE_LIMITED'; end if;
  perform 1 from public.profile_wall_posts where id=p_post_id for update;
  if (select count(*) from public.wall_post_replies where post_id=p_post_id)>=500 then raise exception 'WALL_REPLIES_FULL'; end if;
  if p_media_path is not null and (split_part(p_media_path,'/',1)<>auth.uid()::text
      or p_media_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$'
      or not exists(select 1 from storage.objects o where bucket_id='profile-wall-media' and name=p_media_path
        and case when (to_jsonb(o)->'metadata'->>'size') ~ '^[0-9]{1,12}$'
          then (to_jsonb(o)->'metadata'->>'size')::bigint between 1 and 6291456 else false end
        and to_jsonb(o)->'metadata'->>'mimetype' in('image/jpeg','image/png','image/webp','image/gif')))
    then raise exception 'WALL_MEDIA_INVALID'; end if;
  insert into public.wall_post_replies(id,post_id,user_id,body,media_path,gif_url)
    values(p_id,p_post_id,auth.uid(),clean_body,p_media_path,p_gif_url);
  return public.get_wall_post_activity(p_post_id);
end; $$;
revoke all on function public.publish_wall_post_reply_media(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_wall_post_reply_media(uuid,uuid,text,text,text) to authenticated;

-- Keep the text-only API strict and retry-safe, including attachment identity.
create or replace function public.publish_wall_post_reply(p_post_id uuid,p_id uuid,p_body text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform public.wall_interaction_owner(p_post_id);
  if p_body is null or char_length(btrim(p_body)) not between 1 and 1000 then raise exception 'WALL_REPLY_INVALID'; end if;
  return public.publish_wall_post_reply_media(p_post_id,p_id,p_body,null,null);
end; $$;

create or replace function public.delete_wall_post_reply(p_post_id uuid,p_reply_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare path text;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  perform public.wall_interaction_owner(p_post_id);
  delete from public.wall_post_replies where id=p_reply_id and post_id=p_post_id and user_id=auth.uid() returning media_path into path;
  return public.get_wall_post_activity(p_post_id) || jsonb_build_object('deletedMediaPath',path);
end; $$;

-- Preserve one STABLE export snapshot, reservation, row and byte bounds. Only
-- the requesting player's contributions export; storage metadata already does.
alter function public.build_data_export(uuid,uuid) rename to build_data_export_without_reply_media;
revoke all on function public.build_data_export_without_reply_media(uuid,uuid) from public,anon,authenticated,service_role;
create function public.build_data_export(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  select public.build_data_export_without_reply_media(p_user_id,p_request_id) || jsonb_build_object(
    'wall_post_replies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'post_id',post_id,'text',body,
      'gif_url',gif_url,'has_image',media_path is not null,'created_at',created_at))
      from (select * from public.wall_post_replies where user_id=p_user_id limit 100001) r),'[]'::jsonb)
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
