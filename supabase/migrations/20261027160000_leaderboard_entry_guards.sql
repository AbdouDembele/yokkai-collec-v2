begin;

-- Cosmetics require volatile entitlement reads. Each API entry point must
-- therefore carry the ban guard itself, before calling its protected projection.
create or replace function public.get_collection_leaderboard(p_offset integer,p_limit integer,p_query text,p_friends_only boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_player_not_banned();
  result:=public.leaderboard_collection_without_styles(p_offset,p_limit,p_query,p_friends_only);
  return result||jsonb_build_object('profileStyles',coalesce((
    select jsonb_object_agg(item->>'userId',public.billing_profile_cosmetics((item->>'userId')::uuid))
    from jsonb_array_elements(result->'entries') item
  ),'{}'::jsonb),'cardCounts',coalesce((
    select jsonb_object_agg(user_id,counts) from (
      select targets.user_id,jsonb_build_object(
        'sr',count(owned.id) filter(where c.rarete_base='SR'),
        'ssr',count(owned.id) filter(where c.rarete_base='SSR'),
        'lr',count(owned.id) filter(where c.rarete_base='LR'),
        'infinity',count(owned.id) filter(where
          (c.rarete_base='SSR' and (owned.is_evolved or owned.is_shiny))
          or (c.rarete_base='LR' and owned.is_evolved)),
        'shiny',count(owned.id) filter(where c.rarete_base='LR' and owned.is_shiny and not owned.is_evolved)
      ) counts
      from (
        select (item->>'userId')::uuid user_id from jsonb_array_elements(result->'entries') item
        union select auth.uid()
      ) targets
      left join public.user_cards owned on owned.user_id=targets.user_id
      left join public.cards c on c.id=owned.card_id
      group by targets.user_id
    ) counted
  ),'{}'::jsonb));
end; $$;

create or replace function public.get_collection_leaderboard(p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  perform public.assert_player_not_banned();
  return public.get_collection_leaderboard(p_offset,greatest(1,least(coalesce(p_limit,20),50)),'',false);
end; $$;

create or replace function public.get_referral_leaderboard(p_offset integer default 0,p_limit integer default 100,p_query text default '',p_friends_only boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_player_not_banned();
  result:=public.leaderboard_referrals_without_styles(p_offset,p_limit,p_query,p_friends_only);
  return result||jsonb_build_object('profileStyles',coalesce((
    select jsonb_object_agg(item->>'userId',public.billing_profile_cosmetics((item->>'userId')::uuid))
    from jsonb_array_elements(result->'entries') item
  ),'{}'::jsonb));
end; $$;

revoke all on function public.get_collection_leaderboard(integer,integer),
  public.get_collection_leaderboard(integer,integer,text,boolean),
  public.get_referral_leaderboard(integer,integer,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.get_collection_leaderboard(integer,integer),
  public.get_collection_leaderboard(integer,integer,text,boolean),
  public.get_referral_leaderboard(integer,integer,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
