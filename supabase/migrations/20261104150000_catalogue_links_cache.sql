-- Performance: public.catalogue_binder_links (cards x binders, about 83 000
-- rows built from 14 editorial tables) was recomputed in full by every call of
-- 18 catalogue, binder, favorite and ranking functions: about 1 s of the 1.9 s
-- spent in get_binder_albums_page. Its rows are now stored in
-- public.catalogue_binder_links_cache and rebuilt by pg_cron every minute when
-- a source changed.
--
-- Exactness: every write statement on a source column bumps a version number.
-- While the cache is older than that version, the view reads the original
-- definition (public.catalogue_binder_links_source) instead of the cache, so
-- results never differ from the previous behaviour; only the speed does, for
-- at most a minute after an editorial change. Bulk or row-by-row editorial
-- scripts cost one tiny update per statement, never a rebuild.
--
-- public.catalogue_binder_links keeps its name, columns, options and
-- permissions; the functions resolve it by name at call time.
begin;
set local lock_timeout = '3s';

alter view public.catalogue_binder_links rename to catalogue_binder_links_source;
revoke all on public.catalogue_binder_links_source from public, anon, authenticated, service_role;

create table public.catalogue_binder_links_cache (
  card_id uuid,
  category text,
  source_license text,
  binder_key text,
  display_name text,
  origin text,
  series_binder_id uuid
);
create index catalogue_binder_links_cache_binder_idx on public.catalogue_binder_links_cache (binder_key);
create index catalogue_binder_links_cache_card_idx on public.catalogue_binder_links_cache (card_id);
create index catalogue_binder_links_cache_series_idx on public.catalogue_binder_links_cache (series_binder_id);
create index catalogue_binder_links_cache_license_idx on public.catalogue_binder_links_cache (source_license);
alter table public.catalogue_binder_links_cache enable row level security;
revoke all on public.catalogue_binder_links_cache from public, anon, authenticated, service_role;

create table public.catalogue_links_cache_state (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 0,
  built_version bigint not null default 0
);
insert into public.catalogue_links_cache_state default values;
alter table public.catalogue_links_cache_state enable row level security;
revoke all on public.catalogue_links_cache_state from public, anon, authenticated, service_role;

-- Security definer: some source tables accept writes through player or admin
-- paths with their own rights; the state row itself stays private.
create function public.bump_catalogue_links_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.catalogue_links_cache_state set version = version + 1 where singleton;
  return null;
end;
$$;
revoke all on function public.bump_catalogue_links_version() from public, anon, authenticated, service_role;

create trigger catalogue_links_changed
  after insert or delete or truncate or update of display_name, id
  on public.anime_license_binders
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of binder_id, enforce_separation, media_id
  on public.anime_license_media_rules
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of binder_id, source_license
  on public.anime_license_source_rules
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of display_name, id
  on public.anime_series_binders
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of card_id, media_id, source_license
  on public.anime_series_card_assignments
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of binder_id, decision, editorial_approved, media_id
  on public.anime_series_media_rules
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of card_id, character_id, media_id, verified_snapshot
  on public.anime_series_origin_evidence
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of card_id
  on public.anime_series_protected_cards
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of enabled, license_grouping_enabled, singleton
  on public.anime_series_settings
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of card_id, franchise, position
  on public.card_franchises
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of categorie, franchise, id, source, source_id
  on public.cards
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of group_id, old_key
  on public.catalogue_binder_group_merges
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of display_name, enabled, id
  on public.catalogue_binder_groups
  for each statement execute function public.bump_catalogue_links_version();
create trigger catalogue_links_changed
  after insert or delete or truncate or update of category, group_id, source_license
  on public.catalogue_binder_source_merges
  for each statement execute function public.bump_catalogue_links_version();

-- Single writer (pg_cron). The version is read first; the rebuild statement
-- runs on a later snapshot that contains every change up to that version.
-- Later changes keep the cache marked stale until the next run.
create function public.refresh_catalogue_links_cache()
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
  update public.catalogue_links_cache_state set built_version = target where singleton;
end;
$$;
revoke all on function public.refresh_catalogue_links_cache() from public, anon, authenticated, service_role;

insert into public.catalogue_binder_links_cache
  select l.card_id, l.category, l.source_license, l.binder_key, l.display_name, l.origin, l.series_binder_id
  from public.catalogue_binder_links_source l;
analyze public.catalogue_binder_links_cache;

-- The uncorrelated freshness check is planned as a one-time filter: only one
-- branch runs.
create view public.catalogue_binder_links with (security_barrier = true) as
  select c.card_id, c.category, c.source_license, c.binder_key, c.display_name, c.origin, c.series_binder_id
  from public.catalogue_binder_links_cache c
  where (select s.version = s.built_version from public.catalogue_links_cache_state s where s.singleton)
  union all
  select l.card_id, l.category, l.source_license, l.binder_key, l.display_name, l.origin, l.series_binder_id
  from public.catalogue_binder_links_source l
  where not (select s.version = s.built_version from public.catalogue_links_cache_state s where s.singleton);
revoke all on public.catalogue_binder_links from public, anon, authenticated, service_role;

select cron.schedule('refresh-catalogue-links-cache', '* * * * *',
  'select public.refresh_catalogue_links_cache();');

commit;
