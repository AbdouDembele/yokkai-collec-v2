begin;

alter table public.user_profiles drop constraint user_profiles_featured_card_ids_check;
alter table public.user_profiles add constraint user_profiles_featured_card_ids_check check (cardinality(featured_card_ids)<=10);

create function public.billing_update_profile_fields(
  p_bio text,p_avatar_url text,p_featured_card_ids uuid[],p_banner_card_id uuid,p_preserve_banner boolean
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  player_id uuid:=auth.uid();
  cleaned_ids uuid[]:=coalesce(p_featured_card_ids,'{}'::uuid[]);
  avatar text:=nullif(btrim(p_avatar_url),'');
  previous_ids uuid[];
  cap integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||player_id::text,0));
  select featured_card_ids into previous_ids from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if exists(select 1 from public.account_deletion_log where user_id=player_id) then raise exception 'ACCOUNT_DELETED'; end if;
  if avatar is not null and (char_length(p_avatar_url)>2048 or (
    avatar !~ '^https://api[.]yokkai-collec[.]com/storage/v1/object/public/avatars/[A-Za-z0-9_/-]+[.](jpg|jpeg|png|webp|gif)([?]v=[0-9]+)?$'
    and not exists(select 1 from public.profile_media_assets where user_id=player_id and purpose='avatar' and public_url=avatar)))
    then raise exception 'AVATAR_URL_INVALID'; end if;
  if char_length(coalesce(p_bio,''))>300 then raise exception 'BIO_TOO_LONG'; end if;
  cap:=case when public.billing_has_game_pro(player_id) then 10 else 5 end;
  -- A downgrade never deletes earned cards or an existing showcase, and must
  -- not prevent saving an unrelated biography with the same saved selection.
  if (cardinality(cleaned_ids)>cap and cleaned_ids is distinct from previous_ids)
    or cardinality(cleaned_ids)<>(select count(distinct x) from unnest(cleaned_ids) x)
    then raise exception 'FEATURED_CARDS_INVALID'; end if;
  if exists(select 1 from unnest(cleaned_ids) x where not exists(
    select 1 from public.user_cards uc where uc.id=x and uc.user_id=player_id)) then raise exception 'CARD_NOT_OWNED'; end if;
  if p_banner_card_id is not null then
    perform uc.id from public.user_cards uc where uc.user_id=player_id and uc.card_id=p_banner_card_id
      order by uc.id limit 1 for share;
    if not found then raise exception 'BANNER_CARD_NOT_OWNED'; end if;
  end if;
  update public.user_profiles set bio=coalesce(p_bio,''),avatar_url=avatar,
    featured_card_ids=cleaned_ids,banner_card_id=p_banner_card_id,
    banner_url=case when p_preserve_banner and p_banner_card_id is null then banner_url else null end,
    banner_frame=case when banner_frame_source=p_banner_card_id::text then banner_frame else null end,
    banner_frame_source=case when banner_frame_source=p_banner_card_id::text then banner_frame_source else null end
    where user_id=player_id;
  return public.get_profile(null);
end;
$$;
revoke all on function public.billing_update_profile_fields(text,text,uuid[],uuid,boolean) from public,anon,authenticated;

create or replace function public.update_profile(p_bio text,p_avatar_url text,p_featured_card_ids uuid[],p_banner_card_id uuid default null)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select public.billing_update_profile_fields(p_bio,p_avatar_url,p_featured_card_ids,p_banner_card_id,false);
$$;
revoke all on function public.update_profile(text,text,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.update_profile(text,text,uuid[],uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
