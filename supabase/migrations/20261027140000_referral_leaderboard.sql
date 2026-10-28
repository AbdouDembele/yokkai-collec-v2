begin;

-- Public aggregate counts only: never return referral codes, child identities,
-- verification timestamps, rewards, email addresses or Auth metadata.
create function public.get_referral_leaderboard(p_offset integer default 0,p_limit integer default 100,p_query text default '',p_friends_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  viewer uuid:=auth.uid(); result jsonb;
  page_offset integer:=greatest(0,least(coalesce(p_offset,0),1000000));
  page_size integer:=greatest(1,least(coalesce(p_limit,100),100));
  search_query text:=left(btrim(coalesce(p_query,'')),64);
  friends_only boolean:=coalesce(p_friends_only,false);
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.assert_player_not_banned();
  if not exists(select 1 from public.user_profiles where user_id=viewer)
    or exists(select 1 from public.account_deletion_log where user_id=viewer)
    then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;

  with active_players as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public
    from public.user_profiles p join auth.users u on u.id=p.user_id
    where coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
      and not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
  ), counts as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public,count(r.id) verified_referrals,
      exists(select 1 from public.friendships f where f.status='accepted' and
        ((f.user_id=viewer and f.friend_id=p.user_id) or (f.friend_id=viewer and f.user_id=p.user_id))) is_friend
    from active_players p left join public.referrals r on r.referrer_id=p.user_id
      and r.rewarded_at is not null
      and exists(select 1 from active_players child where child.user_id=r.referred_id)
    where p.is_public or p.user_id=viewer
    group by p.user_id,p.pseudo,p.avatar_url,p.is_public
  ), ranked as materialized (
    select counts.*,rank() over(order by verified_referrals desc) position,
      row_number() over(order by verified_referrals desc,lower(pseudo),user_id) global_order
    from counts where is_public and verified_referrals>0
  ), visible as materialized (
    select * from ranked r where not public.users_blocked(viewer,r.user_id)
      and (not friends_only or r.is_friend or r.user_id=viewer)
  ), eligible as materialized (
    select * from visible where
      (search_query<>'' and strpos(lower(pseudo),lower(search_query))>0)
      or (search_query='' and (friends_only or global_order<=100))
  ), page as (
    select * from eligible order by verified_referrals desc,lower(pseudo),user_id
      offset page_offset limit page_size
  )
  select jsonb_build_object(
    'offset',page_offset,'limit',page_size,'query',search_query,
    'friendsOnly',friends_only,'topLimit',100,
    'total',(select count(*) from eligible),'rankedPlayers',(select count(*) from ranked),
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'position',position,
      'verifiedReferrals',verified_referrals,'isFriend',is_friend
    ) order by verified_referrals desc,lower(pseudo),user_id) from page),'[]'::jsonb),
    'mine',(select jsonb_build_object(
      'verifiedReferrals',verified_referrals,'isPublic',is_public,
      'position',(select position from ranked where user_id=viewer)
    ) from counts where user_id=viewer)
  ) into result;
  return result;
end; $$;

revoke all on function public.get_referral_leaderboard(integer,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_referral_leaderboard(integer,integer,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
