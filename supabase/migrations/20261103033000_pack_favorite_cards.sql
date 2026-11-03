-- Exact favorite membership for one bounded opening. No progress aggregation,
-- game mutation or identity supplied by the browser.
begin;
set local lock_timeout='3s';
create function public.get_pack_favorite_card_ids(p_card_ids uuid[],p_stable boolean default true)
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); result uuid[];
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_player_not_banned();
  if not exists(select 1 from public.user_profiles where user_id=viewer)
    or exists(select 1 from public.account_deletion_log where user_id=viewer)
    then raise exception 'PROFILE_MISSING'; end if;
  if coalesce(cardinality(p_card_ids),0)>500 then raise exception 'INVALID_CARD_SELECTION'; end if;
  if coalesce(cardinality(p_card_ids),0)=0 then return '{}'::uuid[]; end if;
  if coalesce(p_stable,true) then
    with preferences as materialized (
      select public.canonical_binder_key(p.binder_key) as key,p.binder_key as original,p.favorite,p.license_favorite
      from public.binder_favorite_preferences p where p.user_id=viewer
    ), folded as materialized (
      select p.key,bool_or(p.favorite) as prior_favorite,
        bool_or(p.license_favorite) filter(where p.original=p.key) as direct_choice,
        bool_or(p.license_favorite) as redirected_choice from preferences p group by p.key
    ), candidates as materialized (
      select t.license,min(t.target_key) as key,count(distinct t.target_key) as targets
      from public.binder_legacy_favorite_targets(viewer) t group by t.license
    ), legacy as materialized (select distinct c.key from candidates c where c.targets=1),
    favorites as materialized (
      select k.key as binder_key from (select key from folded union select key from legacy) k
      left join folded p on p.key=k.key left join legacy l on l.key=k.key
      where case when exists(select 1 from public.anime_series_settings
          where singleton and enabled and license_grouping_enabled)
        then coalesce(p.direct_choice,p.redirected_choice,coalesce(p.prior_favorite,false) or l.key is not null)
        else coalesce(p.prior_favorite,false) or (p.key is null and l.key is not null) end
    ), wanted as materialized (
      select distinct id from unnest(p_card_ids) id where id is not null
    )
    select coalesce(array_agg(distinct w.id),'{}'::uuid[]) into result
    from wanted w cross join lateral (
      select l.binder_key from public.catalogue_binder_links l where l.card_id=w.id offset 0
    ) links join favorites f on f.binder_key=links.binder_key;
  else
    select coalesce(array_agg(distinct l.card_id),'{}'::uuid[]) into result
    from public.card_franchises l join public.panini_album_favorites f
      on f.user_id=viewer and f.license=l.franchise
    where l.card_id=any(p_card_ids);
  end if;
  return result;
end; $$;
revoke all on function public.get_pack_favorite_card_ids(uuid[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_pack_favorite_card_ids(uuid[],boolean) to authenticated;
notify pgrst,'reload schema';
commit;
