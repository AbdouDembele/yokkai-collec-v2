begin;
set local lock_timeout='3s';
-- Restore the previous application first; retain all rank observations.
create or replace function public.get_referral_leaderboard(p_offset integer default 0,p_limit integer default 100,p_query text default '',p_friends_only boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_player_not_banned();
  result:=public.leaderboard_referrals_without_styles(p_offset,p_limit,p_query,p_friends_only);
  result:=result||jsonb_build_object('profileStyles',coalesce((
    select jsonb_object_agg(item->>'userId',public.billing_profile_cosmetics((item->>'userId')::uuid))
    from jsonb_array_elements(result->'entries') item
  ),'{}'::jsonb));
  return result;
end; $$;
notify pgrst,'reload schema';
commit;
