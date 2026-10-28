begin;

-- Ranking reveals only the caller's position and population size, never another
-- player's referral count or identity. Zero verified referrals remain unranked.
create function public.get_referral_rank()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid(); result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.user_profiles where user_id=player)
    or exists(select 1 from public.account_deletion_log where user_id=player)
    then raise exception 'PROFILE_MISSING'; end if;
  with active_players as materialized (
    select p.user_id from public.user_profiles p
    where not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
  ), counts as materialized (
    select p.user_id,count(r.id) verified
    from active_players p left join public.referrals r
      on r.referrer_id=p.user_id and r.rewarded_at is not null
      and exists(select 1 from active_players child where child.user_id=r.referred_id)
    group by p.user_id
  ), mine as (select verified from counts where user_id=player)
  select jsonb_build_object(
    'verifiedReferrals',mine.verified,'totalPlayers',(select count(*) from counts),
    'position',case when mine.verified>0 then 1+(select count(*) from counts where verified>mine.verified) else null end,
    -- Use the end of a tie for the percentile: ties share a position and badge,
    -- and an entire tied population cannot all be advertised as the top 10%.
    'topPercent',case when mine.verified>0 then least(100,greatest(10,
      10*ceil(10.0*(select count(*) from counts where verified>=mine.verified)
        /nullif((select count(*) from counts),0)))) else null end
  ) into result from mine;
  return result;
end; $$;
revoke all on function public.get_referral_rank() from public,anon,authenticated,service_role;
grant execute on function public.get_referral_rank() to authenticated;

commit;
