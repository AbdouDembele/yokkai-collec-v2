begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

-- Retire profile view tracking, not likes. Historical data is not destroyed.
create or replace function public.get_profile_engagement(p_owner_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_owner_id is null then raise exception 'INVALID_PROFILE'; end if;
  perform public.get_profile(p_owner_id::text);
  return jsonb_build_object(
    'likes',(select count(*) from public.profile_likes where owner_id=p_owner_id),
    'likedByMe',exists(select 1 from public.profile_likes where owner_id=p_owner_id and user_id=auth.uid())
  );
end; $$;

revoke all on function public.get_profile_engagement(uuid) from public,anon,authenticated;
grant execute on function public.get_profile_engagement(uuid) to authenticated;

-- No CASCADE: unexpected dependencies abort the transaction.
drop function public.record_profile_view(uuid,uuid);
-- History stays private and inert for a separately authorized retention decision.
-- Preserve account-deletion guards, cascading cleanup and own-data export.
revoke all on public.profile_visit_receipts from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;

