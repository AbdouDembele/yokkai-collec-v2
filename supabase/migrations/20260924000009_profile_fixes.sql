begin;

-- These read the current player's private balance/timers. The profile migration
-- intentionally removed direct access to those columns, so they must execute as
-- their owner while continuing to scope every lookup with auth.uid().
alter function public.get_game_info() security definer;
alter function public.get_regular_pack_status() security definer;

-- Storage upsert checks SELECT before UPDATE when avatar.<ext> already exists.
create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

commit;
