-- get_game_info reads the caller's private profile after validating auth.uid().
-- Keep direct user_profiles access closed while allowing this narrow RPC to read it.
begin;

alter function public.get_game_info() security definer;

revoke all on function public.get_game_info() from public, anon, authenticated;
grant execute on function public.get_game_info() to authenticated;

commit;
