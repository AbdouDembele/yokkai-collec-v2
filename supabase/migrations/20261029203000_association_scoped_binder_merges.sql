begin;

-- A title can share a parent binder without authorizing a merge of that parent.
-- Keep the existing whole-binder redirects and add an exact association scope.
create table public.catalogue_binder_source_merges (
  category text not null check (btrim(category) <> ''),
  source_license text not null check (btrim(source_license) <> ''),
  group_id uuid not null references public.catalogue_binder_groups(id),
  primary key (category, source_license)
);
create index catalogue_binder_source_merges_group_idx
  on public.catalogue_binder_source_merges(group_id);
alter table public.catalogue_binder_source_merges enable row level security;
revoke all on public.catalogue_binder_source_merges from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.catalogue_binder_source_merges to service_role;

create or replace view public.catalogue_binder_links with (security_barrier=true) as
select raw.card_id, raw.category, raw.source_license,
  case when scoped.id is not null then 'series:' || scoped.id::text
       when grouped.id is not null then 'series:' || grouped.id::text
       else raw.binder_key end as binder_key,
  coalesce(scoped.display_name, grouped.display_name, raw.display_name) as display_name,
  case when scoped.id is not null or grouped.id is not null then 'series'
       else raw.origin end as origin,
  coalesce(scoped.id, grouped.id, raw.series_binder_id) as series_binder_id
from public.catalogue_binder_links_unmerged raw
left join public.catalogue_binder_source_merges association
  on association.category=raw.category and association.source_license=raw.source_license
left join public.catalogue_binder_groups scoped
  on scoped.id=association.group_id and scoped.enabled
left join public.catalogue_binder_group_merges redirect
  on redirect.old_key=raw.binder_key
left join public.catalogue_binder_groups grouped
  on grouped.id=redirect.group_id and grouped.enabled;

revoke all on public.catalogue_binder_links from public, anon, authenticated, service_role;

commit;
