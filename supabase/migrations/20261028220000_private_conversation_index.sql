begin;

-- Index only the caller's currently permitted conversations. Listing never
-- acknowledges messages; the existing bounded read-watermark RPC does that.
create function public.get_private_conversations(
  p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 30
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); page_size integer:=least(50,greatest(1,coalesce(p_limit,30))); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_player_not_banned();
  if (p_before is null)<>(p_before_id is null) then raise exception 'MESSAGE_CURSOR_INVALID';end if;
  with friends as materialized (
    select distinct case when f.user_id=viewer then f.friend_id else f.user_id end friend_id
    from public.friendships f where f.status='accepted' and viewer in(f.user_id,f.friend_id)
  ), permitted as materialized (
    select friend_id from friends where public.private_messaging_allowed(viewer,friend_id)
  ), latest as materialized (
    select p.user_id friend_id,p.pseudo,p.avatar_url,m.created_at,m.sender_id,m.body,m.gif_url,m.moderated_at
    from permitted a join public.user_profiles p on p.user_id=a.friend_id
    cross join lateral (
      select m.created_at,m.sender_id,m.body,m.gif_url,m.moderated_at from public.private_messages m
      where m.pair_low=least(viewer,a.friend_id) and m.pair_high=greatest(viewer,a.friend_id)
      order by m.created_at desc,m.id desc limit 1
    )m
  ), page as materialized (
    select * from latest where p_before is null or(created_at,friend_id)<(p_before,p_before_id)
    order by created_at desc,friend_id desc limit page_size+1
  ), visible as materialized (select * from page order by created_at desc,friend_id desc limit page_size)
  select jsonb_build_object('viewerId',viewer,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'friend',jsonb_build_object('id',friend_id,'pseudo',pseudo,'avatarUrl',avatar_url),
      'lastAt',created_at,'own',sender_id=viewer,
      'preview',case when moderated_at is not null then '' else left(body,160) end,
      'kind',case when moderated_at is not null then 'moderated' when body='' and gif_url is not null then 'gif' else 'text' end
    )order by created_at desc,friend_id desc)from visible),'[]'::jsonb),
    'next',case when(select count(*)from page)>page_size then
      (select jsonb_build_object('at',created_at,'id',friend_id)from visible order by created_at,friend_id limit 1)
      else null end)into result;
  return result;
end;$$;
revoke all on function public.get_private_conversations(timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_private_conversations(timestamptz,uuid,integer) to authenticated;

commit;
