begin;

-- Existing per-author wall index serves each accepted friend's bounded prefix.
-- Viewer identity is never supplied by the caller. Existing wall/media ACLs stay intact.
create function public.get_friend_wall_feed(
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
  with friends as materialized (
    select f.friend_id id from public.friendships f
      where f.user_id=viewer and f.status='accepted'
    union
    select f.user_id id from public.friendships f
      where f.friend_id=viewer and f.status='accepted'
  ), page as materialized (
    select wall.*,p.pseudo,p.avatar_url,
      row_number() over(order by wall.created_at desc,wall.id desc) n
    from friends f
    join public.user_profiles p on p.user_id=f.id
    join auth.users u on u.id=f.id
    cross join lateral (
      select w.id,w.user_id,w.body,w.media_path,w.gif_url,w.created_at
      from public.profile_wall_posts w where w.user_id=f.id
        and (p_before is null or (w.created_at,w.id)<(p_before,p_before_id))
      order by w.created_at desc,w.id desc limit safe_limit+1
    ) wall
    where public.can_read_profile_wall(f.id)
      and (u.banned_until is null or u.banned_until<=now())
    order by wall.created_at desc,wall.id desc limit safe_limit+1
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

revoke all on function public.get_friend_wall_feed(timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_friend_wall_feed(timestamptz,uuid,integer)
  to authenticated;
notify pgrst, 'reload schema';
commit;
