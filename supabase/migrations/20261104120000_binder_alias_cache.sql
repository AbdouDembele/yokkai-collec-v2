begin;

-- Performance (prod audit, point F). public.active_binder_aliases was a view
-- combining the license and series alias tables, the editorial merges and the
-- binder groups through UNIONs. Every catalogue call recomputed it in full
-- (15 to 80 ms per reference, several references per call): 64 billion alias
-- rows read in 9 days. These editorial tables change rarely, so the rows are
-- now stored in public.binder_alias_cache and rebuilt by statement triggers
-- whenever a source table changes. public.active_binder_aliases keeps its name,
-- columns, options and permissions: the catalogue functions are unchanged and
-- resolve it by name at call time.

alter view public.active_binder_aliases rename to active_binder_aliases_source;
revoke all on public.active_binder_aliases_source from public, anon, authenticated, service_role;

create table public.binder_alias_cache (
  binder_id uuid,
  alias text
);
create index binder_alias_cache_binder_idx on public.binder_alias_cache (binder_id);
create index binder_alias_cache_alias_idx on public.binder_alias_cache (alias);
alter table public.binder_alias_cache enable row level security;
revoke all on public.binder_alias_cache from public, anon, authenticated, service_role;

-- Full rebuild (about 12 000 rows): cheap for editorial statements, which are
-- rare and set-based. The lock serializes concurrent rebuilds; readers keep
-- their snapshot until the writing transaction commits.
create function public.refresh_binder_alias_cache()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  lock table public.binder_alias_cache in share row exclusive mode;
  delete from public.binder_alias_cache;
  insert into public.binder_alias_cache (binder_id, alias)
    select s.binder_id, s.alias from public.active_binder_aliases_source s;
  return null;
end;
$$;
revoke all on function public.refresh_binder_alias_cache() from public, anon, authenticated, service_role;

create trigger refresh_binder_alias_cache
  after insert or update or delete or truncate on public.anime_license_aliases
  for each statement execute function public.refresh_binder_alias_cache();
create trigger refresh_binder_alias_cache
  after insert or update or delete or truncate on public.anime_series_aliases
  for each statement execute function public.refresh_binder_alias_cache();
create trigger refresh_binder_alias_cache
  after insert or update or delete or truncate on public.anime_series_settings
  for each statement execute function public.refresh_binder_alias_cache();
create trigger refresh_binder_alias_cache
  after insert or update or delete or truncate on public.catalogue_binder_groups
  for each statement execute function public.refresh_binder_alias_cache();
create trigger refresh_binder_alias_cache
  after insert or update or delete or truncate on public.catalogue_binder_group_merges
  for each statement execute function public.refresh_binder_alias_cache();

insert into public.binder_alias_cache (binder_id, alias)
  select s.binder_id, s.alias from public.active_binder_aliases_source s;
analyze public.binder_alias_cache;

create view public.active_binder_aliases with (security_barrier = true) as
  select c.binder_id, c.alias from public.binder_alias_cache c;
revoke all on public.active_binder_aliases from public, anon, authenticated, service_role;

commit;
