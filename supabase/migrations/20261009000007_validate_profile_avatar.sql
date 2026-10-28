-- Only future profile updates are validated; existing avatars are left intact.
-- Read-only production inventory on 2026-10-09: all 12 avatars use this origin
-- and the avatars bucket; none originate from Google, Discord or another host.
begin;

create or replace function public.update_profile(
  p_bio text,
  p_avatar_url text,
  p_featured_card_ids uuid[],
  p_banner_card_id uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); cleaned_ids uuid[]:=coalesce(p_featured_card_ids,'{}'::uuid[]);
  avatar text:=nullif(btrim(p_avatar_url),'');
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if avatar is not null and (
    char_length(p_avatar_url)>2048 or
    avatar !~ '^https://supabaseenvoy-gawq4yyxiise96wens0dt1ex[.]152[.]228[.]141[.]160[.]sslip[.]io/storage/v1/object/public/avatars/[A-Za-z0-9_/-]+[.](jpg|jpeg|png|webp|gif)([?]v=[0-9]+)?$'
  ) then raise exception 'AVATAR_URL_INVALID' using errcode='P0001'; end if;
  if char_length(coalesce(p_bio,''))>300 then raise exception 'BIO_TOO_LONG' using errcode='P0001'; end if;
  if cardinality(cleaned_ids)>5 or cardinality(cleaned_ids)<>(select count(distinct x) from unnest(cleaned_ids) x)
    then raise exception 'FEATURED_CARDS_INVALID' using errcode='P0001'; end if;
  if exists(select 1 from unnest(cleaned_ids) x where not exists(
    select 1 from public.user_cards uc where uc.id=x and uc.user_id=player_id))
    then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  if p_banner_card_id is not null and not exists(select 1 from public.cards where id=p_banner_card_id)
    then raise exception 'BANNER_CARD_NOT_FOUND' using errcode='P0001'; end if;
  update public.user_profiles set bio=coalesce(p_bio,''),avatar_url=avatar,
    featured_card_ids=cleaned_ids,banner_card_id=p_banner_card_id where user_id=player_id;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return public.get_profile(null);
end; $$;

revoke all on function public.update_profile(text,text,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.update_profile(text,text,uuid[],uuid) to authenticated;

commit;
