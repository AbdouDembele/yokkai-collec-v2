begin;
set local lock_timeout='3s';
-- Read-only rankings: public active profiles only, bilateral blocks, own private
-- metric and bounded pages. No voter identities or private holdings are exposed.
create function public.get_profile_likes_leaderboard(p_offset integer default 0,p_limit integer default 20,p_query text default '',p_friends_only boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  viewer uuid:=auth.uid(); result jsonb;
  page_offset integer:=greatest(0,least(coalesce(p_offset,0),1000000));
  page_size integer:=greatest(1,least(coalesce(p_limit,20),100));
  search_query text:=left(btrim(coalesce(p_query,'')),64);
  friends_only boolean:=coalesce(p_friends_only,false);
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.assert_player_not_banned();
  if not exists(select 1 from public.user_profiles where user_id=viewer)
    or exists(select 1 from public.account_deletion_log where user_id=viewer)
    then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;

  with players as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public,
      exists(select 1 from public.friendships f where f.status='accepted' and
        ((f.user_id=viewer and f.friend_id=p.user_id) or (f.friend_id=viewer and f.user_id=p.user_id))) is_friend
    from public.user_profiles p join auth.users u on u.id=p.user_id
    where (p.is_public or p.user_id=viewer)
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
      and not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
  ), counts as materialized (
    select p.*,count(l.user_id) as value from players p
    left join public.profile_likes l on l.owner_id=p.user_id
    group by p.user_id,p.pseudo,p.avatar_url,p.is_public,p.is_friend
  ), ranked as materialized (
    -- Competition ranks retain ties; alphabetical order only stabilizes display.
    select counts.*,rank() over(order by value desc) position,
      row_number() over(order by value desc,lower(pseudo),user_id) global_order
    from counts where is_public and value>0
  ), visible as materialized (
    select * from ranked r where not public.users_blocked(viewer,r.user_id)
      and (not friends_only or r.is_friend or r.user_id=viewer)
  ), eligible as materialized (
    select * from visible where
      (search_query<>'' and strpos(lower(pseudo),lower(search_query))>0)
      or (search_query='' and (friends_only or global_order<=100))
  ), page as materialized (
    select * from eligible order by value desc,lower(pseudo),user_id offset page_offset limit page_size
  )
  select jsonb_build_object(
    'offset',page_offset,'limit',page_size,'query',search_query,'friendsOnly',friends_only,'topLimit',100,
    'total',(select count(*) from eligible),'rankedPlayers',(select count(*) from ranked),
    'binder',null,
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'position',position,'value',value,'isFriend',is_friend
    ) order by value desc,lower(pseudo),user_id) from page),'[]'::jsonb),
    'mine',(select jsonb_build_object('value',value,'isPublic',is_public,
      'position',(select position from ranked where user_id=viewer)) from counts where user_id=viewer),
    'profileStyles',coalesce((select jsonb_object_agg(user_id,public.billing_profile_cosmetics(user_id)) from page),'{}'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.get_profile_likes_leaderboard(integer,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_profile_likes_leaderboard(integer,integer,text,boolean) to authenticated;

create function public.get_license_leaderboard(p_binder_key text, p_offset integer default 0,p_limit integer default 20,p_query text default '',p_friends_only boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  viewer uuid:=auth.uid(); result jsonb;
  page_offset integer:=greatest(0,least(coalesce(p_offset,0),1000000));
  page_size integer:=greatest(1,least(coalesce(p_limit,20),100));
  search_query text:=left(btrim(coalesce(p_query,'')),64);
  friends_only boolean:=coalesce(p_friends_only,false);
  chosen text:=public.canonical_binder_key(left(btrim(coalesce(p_binder_key,'')),500));
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.assert_player_not_banned();
  if not exists(select 1 from public.user_profiles where user_id=viewer)
    or exists(select 1 from public.account_deletion_log where user_id=viewer)
    then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;
  if chosen='' then raise exception 'BINDER_KEY_REQUIRED'; end if;
  with members as materialized (
    -- Stable keys distinguish homonymous categories; legacy names remain supported
    -- only when the client uses legacy binders. Both include secondary licenses.
    select distinct l.card_id,l.display_name as license from public.catalogue_binder_links l
      where chosen ~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' and l.binder_key=chosen
    union all
    select c.card_id,c.franchise from public.card_franchises c
      where chosen !~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' and c.franchise=chosen
  ), binder as materialized (
    select chosen as key,min(license) as license,count(distinct card_id)::integer as total from members
  ), holdings as materialized (
    -- Current distinct catalogue identities, independent of duplicates/variants.
    select uc.user_id,count(distinct uc.card_id)::integer as value
    from public.user_cards uc join (select distinct card_id from members) m on m.card_id=uc.card_id
    group by uc.user_id
  ), players as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public,
      exists(select 1 from public.friendships f where f.status='accepted' and
        ((f.user_id=viewer and f.friend_id=p.user_id) or (f.friend_id=viewer and f.user_id=p.user_id))) is_friend
    from public.user_profiles p join auth.users u on u.id=p.user_id
    where (p.is_public or p.user_id=viewer)
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
      and not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
  ), counts as materialized (
    select p.*,coalesce(h.value,0)::bigint as value from players p
    left join holdings h on h.user_id=p.user_id
  ), ranked as materialized (
    -- Competition ranks retain ties; alphabetical order only stabilizes display.
    select counts.*,rank() over(order by value desc) position,
      row_number() over(order by value desc,lower(pseudo),user_id) global_order
    from counts where is_public and value>0
  ), visible as materialized (
    select * from ranked r where not public.users_blocked(viewer,r.user_id)
      and (not friends_only or r.is_friend or r.user_id=viewer)
  ), eligible as materialized (
    select * from visible where
      (search_query<>'' and strpos(lower(pseudo),lower(search_query))>0)
      or (search_query='' and (friends_only or global_order<=100))
  ), page as materialized (
    select * from eligible order by value desc,lower(pseudo),user_id offset page_offset limit page_size
  )
  select jsonb_build_object(
    'offset',page_offset,'limit',page_size,'query',search_query,'friendsOnly',friends_only,'topLimit',100,
    'total',(select count(*) from eligible),'rankedPlayers',(select count(*) from ranked),
    'binder',(select jsonb_build_object('key',key,'license',license,'total',total) from binder),
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'position',position,'value',value,'isFriend',is_friend
    ) order by value desc,lower(pseudo),user_id) from page),'[]'::jsonb),
    'mine',(select jsonb_build_object('value',value,'isPublic',is_public,
      'position',(select position from ranked where user_id=viewer)) from counts where user_id=viewer),
    'profileStyles',coalesce((select jsonb_object_agg(user_id,public.billing_profile_cosmetics(user_id)) from page),'{}'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.get_license_leaderboard(text,integer,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_license_leaderboard(text,integer,integer,text,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
