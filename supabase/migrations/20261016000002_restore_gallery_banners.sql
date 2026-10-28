begin;

-- Gallery uploads and owned catalogue cards are both valid banner sources.
-- Reuse the existing owner-only Storage policies, 4 MiB limit and atomic crop RPC.
create or replace function public.update_profile_appearance(
  p_bio text, p_avatar_url text, p_featured_card_ids uuid[],
  p_banner_card_id uuid, p_banner_url text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player uuid := auth.uid();
  banner text := nullif(btrim(p_banner_url),'');
  result jsonb;
  previous_source text;
  previous_frame jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||player::text,0));
  select banner_frame_source,banner_frame into previous_source,previous_frame
    from public.user_profiles where user_id=player for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if exists(select 1 from public.account_deletion_log where user_id=player)
    then raise exception 'ACCOUNT_DELETED'; end if;
  if banner is not null and (char_length(p_banner_url)>2048 or banner !~ (
    '^https://api[.]yokkai-collec[.]com/storage/v1/object/public/avatars/' ||
    player::text || '/banner[.](jpg|jpeg|png|webp|gif)([?]v=[0-9]+)?$'
  )) then raise exception 'BANNER_URL_INVALID'; end if;
  if banner is not null and p_banner_card_id is not null
    then raise exception 'BANNER_URL_INVALID'; end if;
  result := public.update_profile(p_bio,p_avatar_url,p_featured_card_ids,p_banner_card_id);
  update public.user_profiles set
    banner_url=banner,
    banner_frame=case when previous_source=coalesce(banner,p_banner_card_id::text) then previous_frame else null end,
    banner_frame_source=case when previous_source=coalesce(banner,p_banner_card_id::text) then previous_source else null end
    where user_id=player;
  return result || jsonb_build_object('bannerUrl',banner);
end; $$;

revoke all on function public.update_profile_appearance(text,text,uuid[],uuid,text)
  from public,anon,authenticated;
grant execute on function public.update_profile_appearance(text,text,uuid[],uuid,text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
