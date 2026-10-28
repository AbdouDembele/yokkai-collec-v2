-- Increase the public profile showcase from four to five owned card instances.
begin;

alter table public.user_profiles
  drop constraint if exists user_profiles_featured_card_ids_check;
alter table public.user_profiles
  add constraint user_profiles_featured_card_ids_check
  check (cardinality(featured_card_ids) <= 5);

create or replace function public.update_profile(
  p_bio text,
  p_avatar_url text,
  p_featured_card_ids uuid[],
  p_banner_card_id uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); cleaned_ids uuid[]:=coalesce(p_featured_card_ids,'{}'::uuid[]);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if char_length(coalesce(p_bio,''))>300 then raise exception 'BIO_TOO_LONG' using errcode='P0001'; end if;
  if cardinality(cleaned_ids)>5 or cardinality(cleaned_ids)<>(select count(distinct x) from unnest(cleaned_ids) x)
    then raise exception 'FEATURED_CARDS_INVALID' using errcode='P0001'; end if;
  if exists(select 1 from unnest(cleaned_ids) x where not exists(
    select 1 from public.user_cards uc where uc.id=x and uc.user_id=player_id))
    then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  if p_banner_card_id is not null and not exists(select 1 from public.cards where id=p_banner_card_id)
    then raise exception 'BANNER_CARD_NOT_FOUND' using errcode='P0001'; end if;
  update public.user_profiles set bio=coalesce(p_bio,''),avatar_url=nullif(btrim(p_avatar_url),''),
    featured_card_ids=cleaned_ids,banner_card_id=p_banner_card_id where user_id=player_id;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return public.get_profile(null);
end; $$;

revoke all on function public.update_profile(text,text,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.update_profile(text,text,uuid[],uuid) to authenticated;

commit;
