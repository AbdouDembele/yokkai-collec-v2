begin;

-- Extend the existing service-only, reservation-gated account export. No raw
-- player preference is deleted or rewritten during stable-binder integration.
alter function public.build_data_export(uuid,uuid) rename to build_data_export_without_binders;
revoke all on function public.build_data_export_without_binders(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.build_data_export(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  select public.build_data_export_without_binders(p_user_id,p_request_id) || jsonb_build_object(
    'binder_favorite_preferences',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by binder_key)
      from public.binder_favorite_preferences t where user_id=p_user_id),'[]'::jsonb),
    'binder_legacy_favorite_resolutions',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by license)
      from public.binder_legacy_favorite_resolutions t where user_id=p_user_id),'[]'::jsonb),
    'binder_profile_widgets',coalesce((select widgets from public.binder_profile_widgets where user_id=p_user_id),'[]'::jsonb)
  ) into result;
  if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
      when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result))>100000
    or octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
  return result;
end; $$;
revoke all on function public.build_data_export(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.build_data_export(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
