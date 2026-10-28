begin;

-- Storage upserts read the conflicting object before updating it. Keep that
-- read restricted to administrators and to the catalogue image bucket.
create policy card_images_admin_select
on storage.objects for select to authenticated
using (
  bucket_id = 'card-images'
  and (select public.is_current_user_admin())
);

commit;
