begin;

-- Keep the friend-only API intact; Home now includes the viewer's own wall too.
create function public.get_home_wall_feed(
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
  with authors as materialized (
    select viewer id
    union
    select f.friend_id from public.friendships f
      where f.user_id=viewer and f.status='accepted'
    union
    select f.user_id from public.friendships f
      where f.friend_id=viewer and f.status='accepted'
  ), page as materialized (
    select wall.*,p.pseudo,p.avatar_url,
      row_number() over(order by wall.created_at desc,wall.id desc) n
    from authors a
    join public.user_profiles p on p.user_id=a.id
    join auth.users u on u.id=a.id
    cross join lateral (
      select w.id,w.user_id,w.body,w.media_path,w.gif_url,w.created_at
      from public.profile_wall_posts w where w.user_id=a.id
        and (p_before is null or (w.created_at,w.id)<(p_before,p_before_id))
      order by w.created_at desc,w.id desc limit safe_limit+1
    ) wall
    where public.can_read_profile_wall(a.id)
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
revoke all on function public.get_home_wall_feed(timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_home_wall_feed(timestamptz,uuid,integer) to authenticated;

alter table public.wall_post_reactions drop constraint wall_post_reactions_emoji_check;
alter table public.wall_post_reactions add constraint wall_post_reactions_emoji_check
  check(emoji=any(array['thumbs-up','heart','fire','laugh','eyes','sparkles','hundred','party','eggplant',
    'smile','heart-eyes','wow','cry','mind-blown','cool','skull','thinking','salute','clap','raised-hands','handshake','diamond','heart-hands','trophy','star']));

create or replace function public.set_wall_post_reaction(p_post_id uuid,p_emoji text,p_reacted boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  perform pg_advisory_xact_lock(hashtextextended('wall-interactions:'||auth.uid()::text,0));
  perform public.wall_interaction_owner(p_post_id);
  if p_reacted is null or p_emoji is null or p_emoji<>all(array['thumbs-up','heart','fire','laugh','eyes','sparkles','hundred','party','eggplant',
    'smile','heart-eyes','wow','cry','mind-blown','cool','skull','thinking','salute','clap','raised-hands','handshake','diamond','heart-hands','trophy','star'])
    then raise exception 'WALL_REACTION_INVALID'; end if;
  if p_reacted then
    if not exists(select 1 from public.wall_post_reactions where post_id=p_post_id and user_id=auth.uid() and emoji=p_emoji)
      and (select count(*) from public.wall_post_reactions where post_id=p_post_id and user_id=auth.uid())>=8
      then raise exception 'WALL_REACTION_LIMIT'; end if;
    insert into public.wall_post_reactions(post_id,user_id,emoji) values(p_post_id,auth.uid(),p_emoji) on conflict do nothing;
  else delete from public.wall_post_reactions where post_id=p_post_id and user_id=auth.uid() and emoji=p_emoji; end if;
  return public.get_wall_post_activity(p_post_id);
end; $$;
revoke all on function public.set_wall_post_reaction(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_wall_post_reaction(uuid,text,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
