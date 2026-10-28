begin;

-- Every appearance entry point (including old clients) funnels through this
-- function. No Storage, catalogue or inventory privileges are added.
create or replace function public.update_profile(
  p_bio text, p_avatar_url text, p_featured_card_ids uuid[],
  p_banner_card_id uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  player_id uuid := auth.uid();
  cleaned_ids uuid[] := coalesce(p_featured_card_ids, '{}'::uuid[]);
  avatar text := nullif(btrim(p_avatar_url), '');
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||player_id::text,0));
  perform 1 from public.user_profiles where user_id = player_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if exists(select 1 from public.account_deletion_log where user_id = player_id)
    then raise exception 'ACCOUNT_DELETED'; end if;
  if avatar is not null and (
    char_length(p_avatar_url) > 2048 or
    avatar !~ '^https://api[.]yokkai-collec[.]com/storage/v1/object/public/avatars/[A-Za-z0-9_/-]+[.](jpg|jpeg|png|webp|gif)([?]v=[0-9]+)?$'
  ) then raise exception 'AVATAR_URL_INVALID'; end if;
  if char_length(coalesce(p_bio,'')) > 300 then raise exception 'BIO_TOO_LONG'; end if;
  if cardinality(cleaned_ids) > 5
    or cardinality(cleaned_ids) <> (select count(distinct x) from unnest(cleaned_ids) x)
    then raise exception 'FEATURED_CARDS_INVALID'; end if;
  if exists(select 1 from unnest(cleaned_ids) x where not exists(
    select 1 from public.user_cards uc where uc.id = x and uc.user_id = player_id))
    then raise exception 'CARD_NOT_OWNED'; end if;
  if p_banner_card_id is not null then
    -- Pin one owned copy until commit; a simultaneous sale/destruction cannot
    -- validate a stale selection. Any rarity/shiny variant of the card counts.
    perform uc.id from public.user_cards uc
      where uc.user_id = player_id and uc.card_id = p_banner_card_id
      order by uc.id limit 1 for share;
    if not found then raise exception 'BANNER_CARD_NOT_OWNED'; end if;
  end if;
  update public.user_profiles set
    bio = coalesce(p_bio,''), avatar_url = avatar,
    featured_card_ids = cleaned_ids, banner_card_id = p_banner_card_id,
    banner_url = null,
    banner_frame = case when banner_frame_source = p_banner_card_id::text then banner_frame else null end,
    banner_frame_source = case when banner_frame_source = p_banner_card_id::text then banner_frame_source else null end
    where user_id = player_id;
  return public.get_profile(null);
end; $$;

create or replace function public.update_profile_appearance(
  p_bio text, p_avatar_url text, p_featured_card_ids uuid[], p_banner_card_id uuid, p_banner_url text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(btrim(p_banner_url),'') is not null then raise exception 'BANNER_URL_DISABLED'; end if;
  result := public.update_profile(p_bio,p_avatar_url,p_featured_card_ids,p_banner_card_id);
  return result || jsonb_build_object('bannerUrl',null);
end; $$;

revoke all on function public.update_profile(text,text,uuid[],uuid),
  public.update_profile_appearance(text,text,uuid[],uuid,text) from public, anon, authenticated;
grant execute on function public.update_profile(text,text,uuid[],uuid),
  public.update_profile_appearance(text,text,uuid[],uuid,text) to authenticated;

-- Losing the last copy (sale, trade, destruction, admin removal) also removes
-- that card's banner. Deleting a duplicate or moving a folder keeps it intact.
create function public.clear_unowned_profile_banner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id = old.user_id and new.card_id = old.card_id
    then return null; end if;
  update public.user_profiles set
    banner_card_id = null, banner_url = null, banner_frame = null, banner_frame_source = null
    where user_id = old.user_id and banner_card_id = old.card_id
      and not exists(select 1 from public.user_cards uc
        where uc.user_id = old.user_id and uc.card_id = old.card_id);
  return null;
end; $$;
revoke all on function public.clear_unowned_profile_banner() from public, anon, authenticated;
-- Check final transaction state: an SSR evolution can consume every duplicate
-- and create a replacement copy in the same transaction without losing its banner.
create constraint trigger clear_unowned_profile_banner
  after delete or update on public.user_cards
  deferrable initially deferred
  for each row execute function public.clear_unowned_profile_banner();

-- Deliberately no bulk rewrite of existing banners or deletion of stored files.
-- Old uploads/non-owned selections are replaced on the next appearance save.
notify pgrst, 'reload schema';
commit;
