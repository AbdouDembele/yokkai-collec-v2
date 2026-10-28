-- The pack-status RPC reads the private recharge deadline from user_profiles.
-- Keep that table private and expose only the authenticated, user-scoped RPC.
begin;

alter function public.get_regular_pack_status() security definer;

revoke all on function public.get_regular_pack_status() from public, anon, authenticated;
grant execute on function public.get_regular_pack_status() to authenticated;

commit;
