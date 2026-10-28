begin;

-- Avatars and uploaded profile banners share this bucket. Keep all existing
-- MIME restrictions, public visibility, ownership rules and storage policies.
do $$
begin
  update storage.buckets
    set file_size_limit = 4194304
    where id = 'avatars';
  if not found then
    raise exception 'AVATARS_BUCKET_MISSING';
  end if;
end;
$$;

commit;
