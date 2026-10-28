begin;
set local lock_timeout='3s';

-- The existing user_id-leading wall index cannot serve the global timeline.
create index profile_wall_posts_timeline on public.profile_wall_posts(created_at desc,id desc);

create function public.get_public_wall_feed(
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 10
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  viewer uuid:=auth.uid();
  safe_limit integer:=least(greatest(coalesce(p_limit,10),1),20);
  result jsonb;
begin
  if viewer is null or not exists (
    select 1 from auth.users u join public.user_profiles p on p.user_id=u.id
    where u.id=viewer and (u.banned_until is null or u.banned_until<=now())
      and not exists(select 1 from public.account_deletion_log where user_id=viewer)
  ) then raise exception 'AUTH_REQUIRED'; end if;
  if (p_before is null) <> (p_before_id is null) then
    raise exception 'FEED_CURSOR_INVALID';
  end if;
  with page as materialized (
    select w.*,p.pseudo,p.avatar_url,
      row_number() over(order by w.created_at desc,w.id desc) n
    from public.profile_wall_posts w
    join public.user_profiles p on p.user_id=w.user_id
    join auth.users u on u.id=w.user_id
    where p.is_public and public.can_read_profile_wall(w.user_id)
      and (u.banned_until is null or u.banned_until<=now())
      and (p_before is null or (w.created_at,w.id)<(p_before,p_before_id))
    order by w.created_at desc,w.id desc limit safe_limit+1
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'text',body,'hasMedia',media_path is not null,'gifUrl',gif_url,
      'createdAt',created_at,'author',jsonb_build_object(
        'id',user_id,'name',pseudo,'avatarUrl',avatar_url,
        'profileStyle',public.billing_profile_cosmetics(user_id)
      )) order by created_at desc,id desc) from page where n<=safe_limit),'[]'::jsonb),
    'next',case when exists(select 1 from page where n>safe_limit) then
      (select jsonb_build_object('at',created_at,'id',id) from page where n=safe_limit)
      else null end
  ) into result;
  return result;
end; $$;
revoke all on function public.get_public_wall_feed(timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_public_wall_feed(timestamptz,uuid,integer) to authenticated;


-- Reuse the authoritative first-page reader, including actor filtering and media.
-- This removes network N+1 without creating a second implementation of its ACLs.
create function public.get_wall_posts_activity(p_post_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare post_id uuid; activity jsonb; result jsonb:='{}'::jsonb;
begin
  if auth.uid() is null or not public.wall_actor_visible(auth.uid()) then
    raise exception 'AUTH_REQUIRED';
  end if;
  if cardinality(p_post_ids)>20 then raise exception 'WALL_ACTIVITY_LIMIT'; end if;
  for post_id in select distinct id from unnest(p_post_ids) as ids(id) where id is not null loop
    begin
      activity:=public.get_wall_post_activity(post_id);
      result:=result||jsonb_build_object(post_id::text,activity);
    exception when raise_exception then
      if sqlerrm<>'WALL_POST_UNAVAILABLE' then raise; end if;
    end;
  end loop;
  return result;
end; $$;
revoke all on function public.get_wall_posts_activity(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_wall_posts_activity(uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
