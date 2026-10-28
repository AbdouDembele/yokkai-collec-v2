begin;

-- Preserve the ranking/visibility projections. Cosmetics are attached only for
-- the already-authorized, bounded page, using the existing Pro entitlement gate.
alter function public.get_collection_leaderboard(integer,integer,text,boolean)
  rename to leaderboard_collection_without_styles;
revoke all on function public.leaderboard_collection_without_styles(integer,integer,text,boolean)
  from public,anon,authenticated,service_role;

create function public.get_collection_leaderboard(p_offset integer,p_limit integer,p_query text,p_friends_only boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.leaderboard_collection_without_styles(p_offset,p_limit,p_query,p_friends_only);
  return result||jsonb_build_object('profileStyles',coalesce((
    select jsonb_object_agg(item->>'userId',public.billing_profile_cosmetics((item->>'userId')::uuid))
    from jsonb_array_elements(result->'entries') item
  ),'{}'::jsonb));
end; $$;
revoke all on function public.get_collection_leaderboard(integer,integer,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_collection_leaderboard(integer,integer,text,boolean) to authenticated;
alter function public.get_collection_leaderboard(integer,integer) volatile;

alter function public.get_referral_leaderboard(integer,integer,text,boolean)
  rename to leaderboard_referrals_without_styles;
revoke all on function public.leaderboard_referrals_without_styles(integer,integer,text,boolean)
  from public,anon,authenticated,service_role;

create function public.get_referral_leaderboard(p_offset integer default 0,p_limit integer default 100,p_query text default '',p_friends_only boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.leaderboard_referrals_without_styles(p_offset,p_limit,p_query,p_friends_only);
  return result||jsonb_build_object('profileStyles',coalesce((
    select jsonb_object_agg(item->>'userId',public.billing_profile_cosmetics((item->>'userId')::uuid))
    from jsonb_array_elements(result->'entries') item
  ),'{}'::jsonb));
end; $$;
revoke all on function public.get_referral_leaderboard(integer,integer,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_referral_leaderboard(integer,integer,text,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
