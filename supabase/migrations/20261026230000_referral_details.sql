begin;

-- Own referral relationships only; no caller-supplied referrer identity and no
-- access to email, Auth metadata or rewards belonging to another player.
create function public.get_my_referrals(p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid(); page_offset integer:=greatest(0,least(coalesce(p_offset,0),1000000));
  page_size integer:=greatest(1,least(coalesce(p_limit,20),50)); result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.user_profiles where user_id=player)
    or exists(select 1 from public.account_deletion_log where user_id=player)
    then raise exception 'PROFILE_MISSING'; end if;
  with eligible as materialized (
    select r.id,r.referred_id,r.created_at,r.verified_at,p.pseudo,p.avatar_url,
      to_jsonb(u)->>'created_at' account_created_at
    from public.referrals r
    join public.user_profiles p on p.user_id=r.referred_id
    join auth.users u on u.id=r.referred_id
    where r.referrer_id=player
      and not exists(select 1 from public.account_deletion_log d where d.user_id=r.referred_id)
      and not exists(select 1 from public.user_blocks b
        where (b.blocker_id=player and b.blocked_id=r.referred_id)
          or (b.blocked_id=player and b.blocker_id=r.referred_id))
  ), page as (
    select * from eligible order by created_at desc,id desc limit page_size offset page_offset
  )
  select jsonb_build_object('total',(select count(*) from eligible),
    'offset',page_offset,'limit',page_size,'referrals',coalesce((
      select jsonb_agg(jsonb_build_object('id',r.referred_id,'pseudo',r.pseudo,
        'avatarUrl',r.avatar_url,'accountCreatedAt',r.account_created_at,
        'referredAt',r.created_at,'verifiedAt',r.verified_at,
        'boostersOpened',case when public.can_view_collection(player,r.referred_id) then
          coalesce(s.regular_packs_opened,0)+greatest(0,
            (select count(*) from public.decision_packs d where d.user_id=r.referred_id)
            -coalesce(s.profile_decision_packs_offset,0)) else null end
      ) order by r.created_at desc,r.id desc)
      from page r left join public.user_achievement_stats s on s.user_id=r.referred_id
    ),'[]'::jsonb)) into result;
  return result;
end; $$;
revoke all on function public.get_my_referrals(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_my_referrals(integer,integer) to authenticated;

commit;
