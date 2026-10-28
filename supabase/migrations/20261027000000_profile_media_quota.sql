begin;
set local lock_timeout='3s';

-- #376: bound personal storage in the avatars bucket.
-- Quotas per account (change here only):
--   30 validated uploads per rolling 24 h;
--   50 MiB stored in avatars/<uid>/, counting the incoming file at the 4 MiB maximum;
--   unreferenced files older than 24 h are released by public.claim_stale_profile_media.

-- Same ban check as public.assert_player_not_banned(), for server paths where
-- the caller is service_role and auth.uid() is null.
create function public.assert_player_not_banned(p_user_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists(
    select 1 from auth.users u
    where u.id=p_user_id
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')>now()
  ) then
    raise exception 'ACCOUNT_BANNED' using errcode='P0001';
  end if;
  return true;
end $$;
revoke all on function public.assert_player_not_banned(uuid) from public,anon,authenticated,service_role;

create or replace function public.assert_player_not_banned() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.assert_player_not_banned(auth.uid());
end $$;

-- Close the legacy direct upload path: only /api/profile-media (service_role,
-- byte-validated, reserved, quota-checked) writes new avatars objects. Players
-- keep reading and deleting their own files.
drop policy avatars_insert_own on storage.objects;
drop policy avatars_update_own on storage.objects;

create or replace function public.guard_profile_media_reservation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.account_deletion_log where user_id=new.user_id) then raise exception 'ACCOUNT_DELETED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||new.user_id::text,0));
  if exists(select 1 from public.account_deletion_log where user_id=new.user_id) then raise exception 'ACCOUNT_DELETED'; end if;
  perform public.assert_player_not_banned(new.user_id);
  if (new.purpose<>'avatar' or new.animated) and not public.billing_has_game_pro(new.user_id) then raise exception 'PRO_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profile-media:'||new.user_id::text,0));
  if (select count(*) from public.profile_media_assets where user_id=new.user_id and created_at>clock_timestamp()-interval '10 minutes')>=10
    then raise exception 'PROFILE_MEDIA_RATE_LIMITED'; end if;
  if (select count(*) from public.profile_media_assets where user_id=new.user_id and created_at>clock_timestamp()-interval '24 hours')>=30
    then raise exception 'PROFILE_MEDIA_QUOTA_EXCEEDED'; end if;
  if (select coalesce(sum((to_jsonb(o)->'metadata'->>'size')::bigint),0) from storage.objects o
      where o.bucket_id='avatars' and o.name like new.user_id::text||'/%')+4194304>52428800
    then raise exception 'PROFILE_MEDIA_QUOTA_EXCEEDED'; end if;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

-- Files in avatars/<uid>/ older than 24 h that no profile field references.
-- The server removes the returned objects from Storage, then their asset rows.
-- Only plain one-level names are returned (no '..', '%', subfolder, other case):
-- a forged legacy name is skipped, never resolved to another folder or bucket.
create function public.claim_stale_profile_media(p_user_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  with referenced as (
    select substring(url from '/storage/v1/object/public/avatars/([^?]+)') as path
    from (
      select avatar_url as url from public.user_profiles where user_id=p_user_id
      union all select banner_url from public.user_profiles where user_id=p_user_id
      -- Banner crop key: always the current banner URL, a card id or null today.
      union all select banner_frame_source from public.user_profiles where user_id=p_user_id
      union all select style->>'backgroundUrl' from public.profile_customizations where user_id=p_user_id
      union all select style->>'cardBackUrl' from public.profile_customizations where user_id=p_user_id
    ) urls where url is not null
  )
  select coalesce(array_agg(o.name order by o.name),'{}')
  from storage.objects o
  where o.bucket_id='avatars' and p_user_id is not null
    and o.name ~ ('^'||p_user_id::text||'/[A-Za-z0-9_-]+[.](jpg|jpeg|png|webp|gif)$')
    and coalesce((to_jsonb(o)->>'created_at')::timestamptz,'-infinity')<clock_timestamp()-interval '24 hours'
    and o.name not in (select path from referenced where path is not null);
$$;
revoke all on function public.claim_stale_profile_media(uuid) from public,anon,authenticated;
grant execute on function public.claim_stale_profile_media(uuid) to service_role;

commit;
