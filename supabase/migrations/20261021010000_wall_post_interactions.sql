begin;

create table public.wall_post_likes (
  post_id uuid not null references public.profile_wall_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key(post_id,user_id)
);
create index wall_post_likes_author on public.wall_post_likes(user_id,created_at);
create table public.wall_post_replies (
  id uuid primary key,
  post_id uuid not null references public.profile_wall_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check(char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index wall_post_replies_page on public.wall_post_replies(post_id,created_at desc,id desc);
create index wall_post_replies_author on public.wall_post_replies(user_id,created_at);
alter table public.wall_post_likes enable row level security;
alter table public.wall_post_replies enable row level security;
revoke all on public.wall_post_likes,public.wall_post_replies from public,anon,authenticated,service_role;

-- Owner-only helpers: no player can probe a user identity or bypass the post ACL.
create function public.wall_actor_visible(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join public.user_profiles p on p.user_id=u.id
    where u.id=p_user and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now())
    and not exists(select 1 from public.account_deletion_log where user_id=p_user)
    and public.can_read_profile_wall(p_user)
$$;
create function public.wall_interaction_owner(p_post uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid;
begin
  if auth.uid() is null or not public.wall_actor_visible(auth.uid()) then raise exception 'AUTH_REQUIRED'; end if;
  select user_id into owner_id from public.profile_wall_posts where id=p_post;
  if owner_id is null or not public.wall_actor_visible(owner_id) or
    (owner_id<>auth.uid() and not exists(select 1 from public.friendships where status='accepted' and
      ((user_id=auth.uid() and friend_id=owner_id) or (friend_id=auth.uid() and user_id=owner_id))))
    then raise exception 'WALL_POST_UNAVAILABLE'; end if;
  return owner_id;
end; $$;
revoke all on function public.wall_actor_visible(uuid),public.wall_interaction_owner(uuid) from public,anon,authenticated,service_role;

create function public.get_wall_post_activity(p_post_id uuid,p_before timestamptz default null,p_before_id uuid default null)
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
      'author',jsonb_build_object('id',user_id,'name',pseudo,'avatarUrl',avatar_url)) order by created_at desc,id desc)
      from page where n<=10),'[]'::jsonb),
    'next',case when exists(select 1 from page where n=11) then
      (select jsonb_build_object('at',created_at,'id',id) from page where n=10) else null end
  ) into result;
  return result;
end; $$;

-- Desired state, not a toggle: a retry cannot accidentally undo a successful like.
create function public.set_wall_post_like(p_post_id uuid,p_liked boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  perform pg_advisory_xact_lock(hashtextextended('wall-interactions:'||auth.uid()::text,0));
  perform public.wall_interaction_owner(p_post_id);
  if p_liked is null then raise exception 'WALL_LIKE_INVALID'; end if;
  if p_liked then
    insert into public.wall_post_likes(post_id,user_id) values(p_post_id,auth.uid()) on conflict do nothing;
  else delete from public.wall_post_likes where post_id=p_post_id and user_id=auth.uid(); end if;
  return public.get_wall_post_activity(p_post_id);
end; $$;

create function public.publish_wall_post_reply(p_post_id uuid,p_id uuid,p_body text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  perform pg_advisory_xact_lock(hashtextextended('wall-interactions:'||auth.uid()::text,0));
  perform public.wall_interaction_owner(p_post_id);
  if p_id is null or p_body is null or char_length(btrim(p_body)) not between 1 and 1000 then raise exception 'WALL_REPLY_INVALID'; end if;
  if exists(select 1 from public.wall_post_replies where id=p_id) then
    if not exists(select 1 from public.wall_post_replies where id=p_id and post_id=p_post_id and user_id=auth.uid() and body=btrim(p_body))
      then raise exception 'WALL_REPLY_INVALID'; end if;
    return public.get_wall_post_activity(p_post_id);
  end if;
  if (select count(*) from public.wall_post_replies where user_id=auth.uid() and created_at>now()-interval '1 hour')>=30
    or exists(select 1 from public.wall_post_replies where user_id=auth.uid() and created_at>clock_timestamp()-interval '5 seconds')
    then raise exception 'WALL_REPLY_RATE_LIMITED'; end if;
  perform 1 from public.profile_wall_posts where id=p_post_id for update;
  if (select count(*) from public.wall_post_replies where post_id=p_post_id)>=500 then raise exception 'WALL_REPLIES_FULL'; end if;
  insert into public.wall_post_replies(id,post_id,user_id,body) values(p_id,p_post_id,auth.uid(),btrim(p_body));
  return public.get_wall_post_activity(p_post_id);
end; $$;

create function public.delete_wall_post_reply(p_post_id uuid,p_reply_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  perform public.wall_interaction_owner(p_post_id);
  delete from public.wall_post_replies where id=p_reply_id and post_id=p_post_id and user_id=auth.uid();
  return public.get_wall_post_activity(p_post_id);
end; $$;
revoke all on function public.get_wall_post_activity(uuid,timestamptz,uuid),public.set_wall_post_like(uuid,boolean),
  public.publish_wall_post_reply(uuid,uuid,text),public.delete_wall_post_reply(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_wall_post_activity(uuid,timestamptz,uuid),public.set_wall_post_like(uuid,boolean),
  public.publish_wall_post_reply(uuid,uuid,text),public.delete_wall_post_reply(uuid,uuid) to authenticated;

-- Remove authored interactions as soon as account deletion is fenced. Post deletion
-- also cascades automatically; reads hide fenced/banned/blocked identities immediately.
create function public.cleanup_wall_interactions() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.wall_post_likes where user_id=new.user_id;
  delete from public.wall_post_replies where user_id=new.user_id;
  return new;
end; $$;
revoke all on function public.cleanup_wall_interactions() from public,anon,authenticated,service_role;
create trigger cleanup_wall_interactions after insert on public.account_deletion_log
  for each row execute function public.cleanup_wall_interactions();

-- Preserve the existing reservation/fence checks and bounded export. STABLE keeps
-- both reads on the caller statement's snapshot; only the caller's contributions export.
alter function public.build_data_export(uuid,uuid) rename to build_data_export_without_wall_interactions;
revoke all on function public.build_data_export_without_wall_interactions(uuid,uuid) from public,anon,authenticated,service_role;
create function public.build_data_export(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  select public.build_data_export_without_wall_interactions(p_user_id,p_request_id) || jsonb_build_object(
    'wall_post_likes',coalesce((select jsonb_agg(jsonb_build_object('post_id',post_id,'created_at',created_at))
      from (select post_id,created_at from public.wall_post_likes where user_id=p_user_id limit 100001) l),'[]'::jsonb),
    'wall_post_replies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'post_id',post_id,'text',body,'created_at',created_at))
      from (select id,post_id,body,created_at from public.wall_post_replies where user_id=p_user_id limit 100001) r),'[]'::jsonb)
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
