-- Performance: get_binder_albums_page (binder list of a collection or a
-- profile, about 0.7-0.85 s in production on 2026-11-04) spent about 430 ms
-- of 690 ms recounting the cards of all 2 740 binders from the 83 000
-- catalogue links on every call. Those totals are the same for every player.
--
-- Three parts read every link through the catalogue_all CTE: binder totals,
-- binder names (favorite resolution) and covers. Totals and names are
-- catalogue-only: they are now stored in public.catalogue_binder_totals_cache
-- and public.catalogue_binder_names_cache, rebuilt by
-- refresh_catalogue_links_cache in the same transaction as the links cache,
-- and read through views with the same freshness rule (while the links cache
-- is stale, the views compute them from the original definition). Covers are
-- picked per page binder through the binder index (same order: rarity, then
-- card id). Only the owner's cards are still counted live.
--
-- Stored totals and names are used only without a category filter (the
-- default view). With a category filter, the original computation is unchanged.
-- Results, order, pagination, favorites and visibility are identical.
begin;
set local lock_timeout = '3s';

create table public.catalogue_binder_totals_cache (
  binder_key text primary key,
  license text,
  origin text,
  category text,
  total integer not null
);
alter table public.catalogue_binder_totals_cache enable row level security;
revoke all on public.catalogue_binder_totals_cache from public, anon, authenticated, service_role;

-- Same aggregate as the original stats CTE without a category filter.
insert into public.catalogue_binder_totals_cache
  select l.binder_key, min(l.display_name), min(l.origin), min(l.category), count(distinct l.card_id)::integer
  from public.catalogue_binder_links_cache l group by l.binder_key;
analyze public.catalogue_binder_totals_cache;

create view public.catalogue_binder_totals with (security_barrier = true) as
  select t.binder_key, t.license, t.origin, t.category, t.total
  from public.catalogue_binder_totals_cache t
  where (select s.version = s.built_version from public.catalogue_links_cache_state s where s.singleton)
  union all
  select l.binder_key, min(l.display_name), min(l.origin), min(l.category), count(distinct l.card_id)::integer
  from public.catalogue_binder_links_source l
  where not (select s.version = s.built_version from public.catalogue_links_cache_state s where s.singleton)
  group by l.binder_key;
revoke all on public.catalogue_binder_totals from public, anon, authenticated, service_role;

create table public.catalogue_binder_names_cache (
  source_license text,
  display_name text,
  binder_key text,
  series_binder_id uuid
);
alter table public.catalogue_binder_names_cache enable row level security;
revoke all on public.catalogue_binder_names_cache from public, anon, authenticated, service_role;
insert into public.catalogue_binder_names_cache
  select distinct l.source_license, l.display_name, l.binder_key, l.series_binder_id
  from public.catalogue_binder_links_cache l;
analyze public.catalogue_binder_names_cache;

create view public.catalogue_binder_names with (security_barrier = true) as
  select n.source_license, n.display_name, n.binder_key, n.series_binder_id
  from public.catalogue_binder_names_cache n
  where (select s.version = s.built_version from public.catalogue_links_cache_state s where s.singleton)
  union all
  select distinct l.source_license, l.display_name, l.binder_key, l.series_binder_id
  from public.catalogue_binder_links_source l
  where not (select s.version = s.built_version from public.catalogue_links_cache_state s where s.singleton);
revoke all on public.catalogue_binder_names from public, anon, authenticated, service_role;
-- Same single writer as before; totals and names are rebuilt from the links just
-- stored, in the same transaction, before the cache is marked fresh.
create or replace function public.refresh_catalogue_links_cache()
returns void
language plpgsql
set search_path = ''
as $$
declare target bigint;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.refresh_catalogue_links_cache')) then
    return;
  end if;
  select s.version into target from public.catalogue_links_cache_state s
    where s.singleton and s.version <> s.built_version;
  if target is null then return; end if;
  delete from public.catalogue_binder_links_cache;
  insert into public.catalogue_binder_links_cache
    select l.card_id, l.category, l.source_license, l.binder_key, l.display_name, l.origin, l.series_binder_id
    from public.catalogue_binder_links_source l;
  delete from public.catalogue_binder_totals_cache;
  insert into public.catalogue_binder_totals_cache
    select l.binder_key, min(l.display_name), min(l.origin), min(l.category), count(distinct l.card_id)::integer
    from public.catalogue_binder_links_cache l group by l.binder_key;
  delete from public.catalogue_binder_names_cache;
  insert into public.catalogue_binder_names_cache
    select distinct l.source_license, l.display_name, l.binder_key, l.series_binder_id
    from public.catalogue_binder_links_cache l;
  update public.catalogue_links_cache_state set built_version = target where singleton;
end;
$$;
revoke all on function public.refresh_catalogue_links_cache() from public, anon, authenticated, service_role;

do $patch$
declare original text; changed text;
begin
  original := pg_get_functiondef('public.get_binder_albums_page(uuid,text,text,boolean,integer,integer)'::regprocedure);
  if original like '%catalogue_binder_totals%' then raise exception 'BINDER_TOTALS_ALREADY_APPLIED'; end if;

  -- 1. Stored totals without a category filter; original aggregate otherwise.
  changed := regexp_replace(original,
    'stats\s+as\s+materialized\s*\(\s*select\s+l\.binder_key,min\(l\.display_name\)\s+as\s+license,min\(l\.origin\)\s+as\s+origin,min\(l\.category\)\s+as\s+category,\s*count\(distinct\s+l\.card_id\)::integer\s+as\s+total,count\(distinct\s+o\.card_id\)::integer\s+as\s+owned\s+from\s+catalogue\s+l\s+left\s+join\s+owned\s+o\s+on\s+o\.card_id=l\.card_id\s+group\s+by\s+l\.binder_key\s*\),',
    $new$stats as materialized (
      -- Without a category filter: stored totals plus the owner's cards only.
      select t.binder_key,t.license,t.origin,t.category,t.total,coalesce(mine.owned,0)::integer as owned
      from public.catalogue_binder_totals t
      left join (
        select l.binder_key,count(distinct o.card_id)::integer as owned
        from owned o join public.catalogue_binder_links l on l.card_id=o.card_id group by l.binder_key
      ) mine using(binder_key)
      where cardinality((select categories from filters))=0
      union all
      select l.binder_key,min(l.display_name) as license,min(l.origin) as origin,min(l.category) as category,
        count(distinct l.card_id)::integer as total,count(distinct o.card_id)::integer as owned
      from catalogue l left join owned o on o.card_id=l.card_id
      where cardinality((select categories from filters))>0 group by l.binder_key
    ),$new$);
  if changed = original then raise exception 'BINDER_STATS_ANCHOR_MISSING'; end if;

  -- 2. Binder names: stored names without a category filter.
  original := changed;
  changed := regexp_replace(original,
    'names\s+as\s+materialized\s*\(\s*select\s+distinct\s+source_license,display_name,binder_key,series_binder_id\s+from\s+catalogue\s*\),',
    $new$names as materialized (
      select n.source_license,n.display_name,n.binder_key,n.series_binder_id
      from public.catalogue_binder_names n where cardinality((select categories from filters))=0
      union all
      select distinct source_license,display_name,binder_key,series_binder_id from catalogue
      where cardinality((select categories from filters))>0
    ),$new$);
  if changed = original then raise exception 'BINDER_NAMES_ANCHOR_MISSING'; end if;

  -- 3. Popularity names always use the whole catalogue: stored names.
  original := changed;
  changed := regexp_replace(original,
    'select\s+distinct\s+l\.source_license,l\.display_name,l\.binder_key,l\.series_binder_id\s+from\s+catalogue_all\s+l\s+where\s+exists\(select\s+1\s+from\s+pop_unresolved\)',
    $new$select n.source_license,n.display_name,n.binder_key,n.series_binder_id
    from public.catalogue_binder_names n where exists(select 1 from pop_unresolved)$new$);
  if changed = original then raise exception 'BINDER_POP_NAMES_ANCHOR_MISSING'; end if;

  -- 4. Covers: best image of each page binder through the binder index
  -- (same order as before: rarity, then card id), instead of sorting every
  -- link. Same category predicate as the catalogue CTE.
  original := changed;
  changed := regexp_replace(original,
    'covers\s+as\s+materialized\s*\(\s*select\s+distinct\s+on\s+\(l\.binder_key\).*?else\s+4\s+end,c\.id\s*\)',
    $new$covers as materialized (
          select p.binder_key,best.image from page p cross join lateral (
            select c.image_url as image
            from public.catalogue_binder_links l join public.cards c on c.id=l.card_id
            where l.binder_key=p.binder_key
              and (cardinality((select categories from filters))=0
                or upper(btrim(l.category))=any(((select categories from filters))::text[]))
              and nullif(btrim(c.image_url),'') is not null
            order by case c.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,c.id
            limit 1
          ) best
        )$new$);
  if changed = original then raise exception 'BINDER_COVERS_ANCHOR_MISSING'; end if;
  if changed like '%catalogue_all l where exists%' then raise exception 'BINDER_PATCH_INCOMPLETE'; end if;

  execute changed;
end;
$patch$;

notify pgrst, 'reload schema';
commit;
