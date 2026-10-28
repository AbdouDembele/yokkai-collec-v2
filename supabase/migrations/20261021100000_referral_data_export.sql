begin;

-- Preserve the current reservation gate and all earlier export projections.
-- Only this owning wrapper may call the old builder; no new player/table access.
alter function public.build_data_export(uuid,uuid) rename to build_data_export_without_referrals;
revoke all on function public.build_data_export_without_referrals(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.build_data_export(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  -- One STABLE statement: the base file and referral sections share a snapshot.
  select public.build_data_export_without_referrals(p_user_id,p_request_id) || jsonb_build_object(
    'referral_codes',coalesce((
      select jsonb_agg(value order by value::text) from (
        select jsonb_build_object('code',code,'created_at',created_at) value
        from public.referral_codes where user_id=p_user_id limit 100001
      ) own_codes
    ),'[]'::jsonb),
    'referrals',coalesce((
      select jsonb_agg(value order by value::text) from (
        select jsonb_build_object(
          'id',id,'role',case when referrer_id=p_user_id then 'referrer' else 'referred' end,
          'created_at',created_at,'verified_at',verified_at,'rewarded_at',rewarded_at,
          'reward_packs',reward_packs
        ) value from public.referrals
        where referrer_id=p_user_id or referred_id=p_user_id limit 100001
      ) own_referrals
    ),'[]'::jsonb)
  ) into result;
  -- Referral records count toward the same complete-file caps; never truncate.
  if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
      when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result))>100000
    or octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
  return result;
end; $$;
revoke all on function public.build_data_export(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.build_data_export(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
