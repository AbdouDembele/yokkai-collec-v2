begin;

-- Resolve a player's legacy favorites as a set. The previous per-license
-- function scanned the complete catalogue once for every saved favorite.
create function public.binder_legacy_favorite_targets(p_owner uuid)
returns table(license text,target_key text)
language sql stable set search_path='' as $$
  with pending as materialized (
    select f.license from public.panini_album_favorites f
    where f.user_id=p_owner and not exists (
      select 1 from public.binder_legacy_favorite_resolutions r
      where r.user_id=p_owner and r.license=f.license
    )
  ), configured as materialized (
    select f.license,'series:' || r.binder_id::text as target_key
    from pending f join public.anime_license_source_rules r on r.source_license=f.license
    where exists(select 1 from public.anime_series_settings
      where singleton and enabled and license_grouping_enabled)
  ), unresolved as materialized (
    select f.license from pending f where not exists (
      select 1 from configured c where c.license=f.license
    )
  ), catalogue as materialized (
    select distinct l.source_license,l.display_name,l.binder_key,l.series_binder_id
    from public.catalogue_binder_links l where exists(select 1 from unresolved)
  )
  select c.license,c.target_key from configured c
  union
  select f.license,l.binder_key from unresolved f join catalogue l on l.source_license=f.license
  union
  select f.license,l.binder_key from unresolved f join catalogue l on l.display_name=f.license
  union
  select f.license,l.binder_key from unresolved f
    join public.active_binder_aliases a on a.alias=f.license
    join catalogue l on l.series_binder_id=a.binder_id
  where exists(select 1 from public.anime_series_settings
    where singleton and enabled and license_grouping_enabled);
$$;
revoke all on function public.binder_legacy_favorite_targets(uuid) from public,anon,authenticated,service_role;

create or replace function public.binder_favorite_keys(p_owner uuid)
returns table(binder_key text) language plpgsql stable set search_path='' as $$
begin
  if not exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled) then
    return query
    with candidates as materialized (
      select f.license,min(l.binder_key) as key,count(distinct l.binder_key) as targets
      from public.panini_album_favorites f join public.catalogue_binder_links l
        on l.source_license=f.license or l.display_name=f.license
      where f.user_id=p_owner and not exists(select 1 from public.binder_legacy_favorite_resolutions done
        where done.user_id=p_owner and done.license=f.license) group by f.license
    ), legacy as (select distinct candidates.key from candidates where targets=1)
    select pref.binder_key from public.binder_favorite_preferences pref where pref.user_id=p_owner and pref.favorite
    union select legacy.key from legacy where not exists(select 1 from public.binder_favorite_preferences pref
      where pref.user_id=p_owner and pref.binder_key=legacy.key);
    return;
  end if;
  return query
  with old_preferences as materialized (
    select public.canonical_binder_key(p.binder_key) as key,p.binder_key as original,p.favorite,p.license_favorite
    from public.binder_favorite_preferences p where p.user_id=p_owner
  ), folded as materialized (
    select p.key,bool_or(p.favorite) as prior_favorite,
      bool_or(p.license_favorite) filter(where p.original=p.key) as direct_choice,
      bool_or(p.license_favorite) as redirected_choice from old_preferences p group by p.key
  ), candidates as materialized (
    select t.license,min(t.target_key) as key,count(distinct t.target_key) as targets
    from public.binder_legacy_favorite_targets(p_owner) t group by t.license
  ), legacy as (select distinct c.key from candidates c where c.targets=1),
  keys as (select p.key from folded p union select l.key from legacy l)
  select k.key from keys k left join folded p on p.key=k.key left join legacy l on l.key=k.key
  where coalesce(p.direct_choice,p.redirected_choice,coalesce(p.prior_favorite,false) or l.key is not null);
end $$;

create or replace function public.binder_favorite_conflicts(p_owner uuid)
returns jsonb language sql stable set search_path='' as $$
  with targets as materialized (
    select * from public.binder_legacy_favorite_targets(p_owner)
  ), ambiguous as materialized (
    select t.license from targets t group by t.license having count(*)>1
  ), catalogue as materialized (
    select l.binder_key,min(l.display_name) as name,min(l.origin) as origin,
      min(l.category) as category,count(distinct l.card_id) as total
    from public.catalogue_binder_links l
    where exists(select 1 from ambiguous) group by l.binder_key
  ), candidates as (
    select t.license,l.* from targets t join ambiguous a using(license)
    join catalogue l on l.binder_key=t.target_key
  ), conflicts as (
    select c.license,jsonb_agg(jsonb_build_object('binderKey',c.binder_key,'license',c.name,'origin',c.origin,
      'category',c.category,'total',c.total) order by c.name,c.binder_key) as candidates
    from candidates c group by c.license having count(*)>1
  ) select coalesce(jsonb_agg(to_jsonb(conflicts) order by license),'[]'::jsonb) from conflicts;
$$;

notify pgrst,'reload schema';
commit;
