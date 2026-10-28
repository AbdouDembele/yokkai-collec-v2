begin;

-- Keep direct reads owner-only even if SELECT is granted again in the future.
-- Public profile fields remain available through the SECURITY DEFINER RPCs.
alter policy user_profiles_read_authenticated on public.user_profiles
  using ((select auth.uid()) = user_id);

commit;
