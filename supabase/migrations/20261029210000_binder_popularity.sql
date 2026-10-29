begin;
set local lock_timeout = '3s';

-- Public aggregate only: never expose the identities or favorite lists of voters.
-- Resolve each legacy title once, then fold explicit choices exactly as album reads do.
create function public.binder_popularity_counts(p_mode text)
returns table(binder_key text, favorite_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_mode = 'legacy' then
    return query select f.license, count(distinct f.user_id)
      from public.panini_album_favorites f group by f.license;
    return;
  end if;
  if p_mode <> 'stable' or p_mode is null then raise exception 'INVALID_MODE'; end if;
  return query
  with settings as materialized (
    select s.enabled and s.license_grouping_enabled as licensed
    from public.anime_series_settings s where singleton
  ), pending as materialized (
    select f.user_id,f.license from public.panini_album_favorites f
    where not exists(select 1 from public.binder_legacy_favorite_resolutions r
      where r.user_id=f.user_id and r.license=f.license)
  ), titles as materialized (select distinct license from pending),
  configured as materialized (
    select f.license,'series:' || r.binder_id::text as target_key
    from titles f join public.anime_license_source_rules r on r.source_license=f.license
    where (select licensed from settings)
  ), unresolved as materialized (
    select f.license from titles f where not exists(select 1 from configured c where c.license=f.license)
  ), names as materialized (
    select distinct l.source_license,l.display_name,l.binder_key,l.series_binder_id
    from public.catalogue_binder_links l where exists(select 1 from unresolved)
  ), raw_targets as materialized (
    select * from configured
    union select f.license,n.binder_key from unresolved f join names n on n.source_license=f.license
    union select f.license,n.binder_key from unresolved f join names n on n.display_name=f.license
    union select f.license,n.binder_key from unresolved f join public.active_binder_aliases a on a.alias=f.license
      join names n on n.series_binder_id=a.binder_id where (select licensed from settings)
  ), targets as materialized (
    select distinct t.license,public.canonical_binder_key(t.target_key) as key from raw_targets t
  ), candidates as materialized (
    select t.license,min(t.key) as key,count(*) as targets from targets t group by t.license
  ), legacy as materialized (
    select distinct f.user_id,c.key from pending f join candidates c using(license) where c.targets=1
  ), preferences as materialized (
    select p.user_id,public.canonical_binder_key(p.binder_key) as key,
      p.binder_key as original,p.favorite,p.license_favorite from public.binder_favorite_preferences p
  ), folded as materialized (
    select p.user_id,p.key,bool_or(p.favorite) as prior_favorite,
      bool_or(p.license_favorite) filter(where p.original=p.key) as direct_choice,
      bool_or(p.license_favorite) as redirected_choice from preferences p group by p.user_id,p.key
  ), keys as materialized (
    select f.user_id,f.key from folded f union select l.user_id,l.key from legacy l
  ), effective as (
    select k.user_id,k.key from keys k
    left join folded p on p.user_id=k.user_id and p.key=k.key
    left join legacy l on l.user_id=k.user_id and l.key=k.key
    where case when (select licensed from settings)
      then coalesce(p.direct_choice,p.redirected_choice,coalesce(p.prior_favorite,false) or l.key is not null)
      else coalesce(p.prior_favorite,false) or (p.key is null and l.key is not null) end
  ) select e.key,count(distinct e.user_id) from effective e group by e.key;
end $$;
revoke all on function public.binder_popularity_counts(text) from public,anon,authenticated,service_role;
grant execute on function public.binder_popularity_counts(text) to authenticated;

-- Keep all signatures, ACLs, collection privacy checks and filters intact.
-- Rank before LIMIT/OFFSET; personal favorites still precede discovery results.
-- Visiting another player keeps their existing personal progress order.
do $patch$
declare target regprocedure; original text; changed text;
begin
  target := 'public.get_binder_albums_page(uuid,text,text,boolean,integer,integer)'::regprocedure;
  original := pg_get_functiondef(target);
  changed := replace(original,
    'select s.*,exists(select 1 from favorite_keys f where f.key=s.binder_key) as favorite',
    'select s.*,coalesce(pop.favorite_count,0) as popularity,exists(select 1 from favorite_keys f where f.key=s.binder_key) as favorite');
  changed := replace(changed,'from stats s left join searchable n using(binder_key)',
    'from stats s left join (select * from public.binder_popularity_counts(''stable'') where viewer=owner_id) pop using(binder_key) left join searchable n using(binder_key)');
  changed := replace(changed,'order by favorite desc,owned::numeric',
    'order by favorite desc,popularity desc,owned::numeric');
  if changed=original or changed not like '%popularity desc%' or changed not like '%pop.favorite_count%'
    then raise exception 'BINDER_POPULARITY_PATCH_MISMATCH'; end if;
  execute changed;

  foreach target in array array[
    'public.get_panini_albums_page(text,text,integer,integer,boolean)'::regprocedure
  ] loop
    original := pg_get_functiondef(target);
    changed := replace(original,'selected as (',
      'ranked as materialized (
        select progress.*,coalesce(pop.favorite_count,0) as popularity from progress
        left join public.binder_popularity_counts(''legacy'') pop on pop.binder_key=progress.license
      ), selected as (');
    changed := replace(changed,'from progress','from ranked progress');
    -- The ranking CTE itself must still read the original, unranked progress.
    changed := replace(changed,'as popularity from ranked progress','as popularity from progress');
    changed := replace(changed,'order by progress.favorite desc,','order by progress.favorite desc, progress.popularity desc,');
    changed := replace(changed,'order by selected.favorite desc,','order by selected.favorite desc, selected.popularity desc,');
    if changed=original or changed not like '%selected.popularity desc%' or changed not like '%progress.popularity desc%'
      then raise exception 'PANINI_POPULARITY_PATCH_MISMATCH: %',target; end if;
    execute changed;
  end loop;
end $patch$;
notify pgrst,'reload schema';
commit;
