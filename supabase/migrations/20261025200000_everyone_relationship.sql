begin;
set local lock_timeout='3s';

create or replace function public.get_public_wall_feed(
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
      'createdAt',created_at,
      'relationship',case when user_id=viewer then 'self' else
        case public.friendship_state(viewer,user_id)
          when 'accepted' then 'friends'
          when 'outgoing' then 'outgoing_pending'
          when 'incoming' then 'incoming_pending'
          else 'none' end end,
      'requestId',(select f.id from public.friendships f
        where f.user_id=page.user_id and f.friend_id=viewer and f.status='pending'),
      'author',jsonb_build_object(
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


-- Only the sender can cancel a still-pending request. Reuse the social pair lock.
create function public.cancel_friend_request(p_friend_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_friend_id is null or p_friend_id=player_id then
    raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  perform public.lock_social_pair(player_id,p_friend_id);
  delete from public.friendships
    where user_id=player_id and friend_id=p_friend_id and status='pending';
  if not found then raise exception 'ACTION_UNAVAILABLE' using errcode='P0001'; end if;
  return true;
end; $$;
revoke all on function public.cancel_friend_request(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_friend_request(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
