begin;

-- Additive identities for explicitly reviewed merges. No AniList media IDs are
-- invented, and no source card, membership, proof or player preference is rewritten.
create table public.catalogue_binder_groups (
  id uuid primary key,
  display_name text not null check(btrim(display_name)<>'' and char_length(display_name)<=500),
  enabled boolean not null default false
);
create table public.catalogue_binder_group_merges (
  old_key text primary key check(old_key ~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$'),
  group_id uuid not null references public.catalogue_binder_groups(id),
  category text,
  source_license text,
  check((category is null and source_license is null) or
    (category is not null and source_license is not null and old_key=
      'source:' || encode(sha256(convert_to(category || chr(31) || source_license,'UTF8')),'hex')))
);
create index catalogue_binder_group_target_idx on public.catalogue_binder_group_merges(group_id);
alter table public.catalogue_binder_groups enable row level security;
alter table public.catalogue_binder_group_merges enable row level security;
revoke all on public.catalogue_binder_groups,public.catalogue_binder_group_merges from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.catalogue_binder_groups,public.catalogue_binder_group_merges to service_role;

alter view public.catalogue_binder_links rename to catalogue_binder_links_unmerged;
revoke all on public.catalogue_binder_links_unmerged from public,anon,authenticated,service_role;
create view public.catalogue_binder_links with(security_barrier=true) as
select raw.card_id,raw.category,raw.source_license,
  case when g.id is not null then 'series:' || g.id::text else raw.binder_key end as binder_key,
  coalesce(g.display_name,raw.display_name) as display_name,
  case when g.id is not null then 'series' else raw.origin end as origin,
  coalesce(g.id,raw.series_binder_id) as series_binder_id
from public.catalogue_binder_links_unmerged raw
left join public.catalogue_binder_group_merges m on m.old_key=raw.binder_key
left join public.catalogue_binder_groups g on g.id=m.group_id and g.enabled;
revoke all on public.catalogue_binder_links from public,anon,authenticated,service_role;

alter view public.active_binder_aliases rename to active_binder_aliases_unmerged;
revoke all on public.active_binder_aliases_unmerged from public,anon,authenticated,service_role;
create view public.active_binder_aliases with(security_barrier=true) as
select coalesce(g.id,a.binder_id) as binder_id,a.alias
from public.active_binder_aliases_unmerged a
left join public.catalogue_binder_group_merges m on m.old_key='series:' || a.binder_id::text
left join public.catalogue_binder_groups g on g.id=m.group_id and g.enabled
union
select id,display_name from public.catalogue_binder_groups where enabled
union
select g.id,m.source_license from public.catalogue_binder_groups g
join public.catalogue_binder_group_merges m on m.group_id=g.id
where g.enabled and m.source_license is not null;
revoke all on public.active_binder_aliases from public,anon,authenticated,service_role;

create or replace function public.canonical_binder_key(p_key text) returns text
language sql stable set search_path='' as $$
  with prior as (
    select coalesce((select 'series:' || r.binder_id::text
      from public.anime_license_key_redirects r cross join public.anime_series_settings s
      where s.singleton and s.enabled and s.license_grouping_enabled and r.old_key=p_key),p_key) as key
  ) select coalesce(
    (select 'series:' || g.id::text from public.catalogue_binder_group_merges m
      join public.catalogue_binder_groups g on g.id=m.group_id and g.enabled where m.old_key=p_key),
    (select 'series:' || g.id::text from public.catalogue_binder_group_merges m
      join public.catalogue_binder_groups g on g.id=m.group_id and g.enabled where m.old_key=prior.key),prior.key)
  from prior;
$$;
revoke all on function public.canonical_binder_key(text) from public,anon,authenticated,service_role;

-- Canonicalize before counting targets: two historical keys may now identify
-- one binder. Legacy JSON and preferences continue to resolve at read time.
create or replace function public.legacy_binder_targets(p_license text,p_category text default null)
returns table(target_key text) language sql stable set search_path='' as $$
  select distinct public.canonical_binder_key(original.target_key) from (
with configured as materialized (
    select 'series:' || r.binder_id::text as key
    from public.anime_license_source_rules r cross join public.anime_series_settings s
    where s.singleton and s.enabled and s.license_grouping_enabled and r.source_license=p_license
      and (p_category is null or p_category='ANIME/MANGA')
  ) select key from configured
  union
  select distinct l.binder_key from public.catalogue_binder_links l
  where not exists(select 1 from configured) and (p_category is null or l.category=p_category)
    and (l.source_license=p_license or l.display_name=p_license or (
      exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled)
      and exists(select 1 from public.active_binder_aliases a where a.binder_id=l.series_binder_id and a.alias=p_license)))
  ) original(target_key);
$$;

create or replace function public.binder_legacy_favorite_targets(p_owner uuid)
returns table(license text,target_key text)
language sql stable set search_path='' as $$
  select distinct original.license,public.canonical_binder_key(original.target_key) from (
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
    where singleton and enabled and license_grouping_enabled)
  ) original(license,target_key);
$$;

create or replace function public.get_binder_albums_page(
  p_owner_id uuid default null,p_query text default '',p_category text default '',
  p_favorites_only boolean default false,p_offset integer default 0,p_limit integer default 72
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid();owner_id uuid:=coalesce(p_owner_id,auth.uid());
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE';end if;
  return (
    with settings as materialized (
      select s.*,s.enabled and s.license_grouping_enabled as licensed from public.anime_series_settings s where singleton
    ), filters as materialized (select public.card_filter_values(upper(coalesce(p_category,''))) categories),
    terms as materialized (
      select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))),'[[:space:]]+') term where term<>''
    ), catalogue as materialized (
      select distinct l.* from public.catalogue_binder_links l
      where cardinality((select categories from filters))=0
        or upper(btrim(l.category))=any(((select categories from filters))::text[])
    ), owned as materialized (select distinct card_id from public.user_cards where user_id=owner_id),
    stats as materialized (
      select l.binder_key,min(l.display_name) as license,min(l.origin) as origin,min(l.category) as category,
        count(distinct l.card_id)::integer as total,count(distinct o.card_id)::integer as owned
      from catalogue l left join owned o on o.card_id=l.card_id group by l.binder_key
    ), names as materialized (
      select distinct source_license,display_name,binder_key,series_binder_id from catalogue
    ), pending as materialized (
      select f.license from public.panini_album_favorites f where f.user_id=owner_id and not exists (
        select 1 from public.binder_legacy_favorite_resolutions r where r.user_id=owner_id and r.license=f.license
      )
    ), configured as materialized (
      select f.license,'series:' || r.binder_id::text as target_key
      from pending f join public.anime_license_source_rules r on r.source_license=f.license
      where (select licensed from settings)
    ), unresolved as materialized (
      select f.license from pending f where not exists(select 1 from configured c where c.license=f.license)
    ), raw_targets as materialized (
      select * from configured
      union select f.license,n.binder_key from unresolved f join names n on n.source_license=f.license
      union select f.license,n.binder_key from unresolved f join names n on n.display_name=f.license
      union select f.license,n.binder_key from unresolved f join public.active_binder_aliases a on a.alias=f.license
        join names n on n.series_binder_id=a.binder_id where (select licensed from settings)
    ), targets as materialized (
      select distinct license,public.canonical_binder_key(target_key) as target_key from raw_targets
    ), candidates as materialized (
      select t.license,min(t.target_key) as key,count(*) as targets from targets t group by t.license
    ), legacy as materialized (select distinct c.key from candidates c where c.targets=1),
    preferences as materialized (
      select public.canonical_binder_key(p.binder_key) as key,p.binder_key as original,p.favorite,p.license_favorite
      from public.binder_favorite_preferences p where p.user_id=owner_id
    ), folded as materialized (
      select p.key,bool_or(p.favorite) as prior_favorite,
        bool_or(p.license_favorite) filter(where p.original=p.key) as direct_choice,
        bool_or(p.license_favorite) as redirected_choice from preferences p group by p.key
    ), favorite_keys as materialized (
      select k.key from (select key from folded union select key from legacy) k
      left join folded p on p.key=k.key left join legacy l on l.key=k.key
      where case when (select licensed from settings)
        then coalesce(p.direct_choice,p.redirected_choice,coalesce(p.prior_favorite,false) or l.key is not null)
        else coalesce(p.prior_favorite,false) or (p.key is null and l.key is not null) end
    ), conflicts as (
      select c.license,jsonb_agg(jsonb_build_object('binderKey',c.binder_key,'license',c.license_name,
        'origin',c.origin,'category',c.category,'total',c.total) order by c.license_name,c.binder_key) as candidates
      from (select t.license,s.license as license_name,s.binder_key,s.origin,s.category,s.total
        from targets t join stats s on s.binder_key=t.target_key) c
      group by c.license having count(*)>1
    ), searchable as materialized (
      select n.binder_key,string_agg(distinct n.display_name || chr(31) || n.source_license,chr(31)) as names
      from names n where exists(select 1 from terms) group by n.binder_key
    ), alias_names as materialized (
      select 'series:' || a.binder_id::text as binder_key,string_agg(a.alias,chr(31)) as names
      from public.active_binder_aliases a where exists(select 1 from terms) group by a.binder_id
    ), progress as materialized (
      select s.*,exists(select 1 from favorite_keys f where f.key=s.binder_key) as favorite
      from stats s left join searchable n using(binder_key) left join alias_names a using(binder_key)
      where (cardinality((select categories from filters))=0 or upper(btrim(s.category))=any(((select categories from filters))::text[]))
        and not exists(select 1 from terms t where not (n.names ilike '%' || t.term || '%' or coalesce(a.names ilike '%' || t.term || '%',false)))
    ), filtered as materialized (select * from progress where not coalesce(p_favorites_only,false) or favorite),
    page as (select * from filtered order by favorite desc,owned::numeric/nullif(total,0) desc,owned desc,license,binder_key
      offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,72),1),72))
    select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('binderKey',binder_key,
      'license',license,'origin',origin,'total',total,'owned',owned,'favorite',favorite,
      'percent',least(100,round(owned::numeric*100/nullif(total,0))))
      order by favorite desc,owned::numeric/nullif(total,0) desc,owned desc,license,binder_key) from page),'[]'::jsonb),
      'total',(select count(*) from filtered),
      'favoriteConflicts',case when viewer=owner_id then coalesce((select jsonb_agg(to_jsonb(c) order by license) from conflicts c),'[]'::jsonb) else '[]'::jsonb end,
      'mappingVersion',(select mapping_version || ':' || enabled::text || ':' || license_grouping_enabled::text || ':' || license_mapping_version from settings))
  );
end $$;

create or replace function public.get_binder_cards_page(
  p_owner_id uuid,p_binder_key text,p_query text,p_category text,p_rarity text,
  p_owned_only boolean,p_offset integer,p_limit integer,p_sort text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid();owner_id uuid:=coalesce(p_owner_id,auth.uid());
  chosen text:=public.canonical_binder_key(p_binder_key);chosen_id uuid;enabled boolean;licensed boolean;
  ordering text:=case when p_sort in ('rarity','name','recent','oldest') then p_sort else 'rarity' end;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE';end if;
  if chosen is null or chosen !~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' then raise exception 'BINDER_KEY_REQUIRED';end if;
  select s.enabled,s.enabled and s.license_grouping_enabled into enabled,licensed from public.anime_series_settings s where singleton;
  select b.id into chosen_id from public.anime_series_binders b where 'series:' || b.id::text=chosen;
  return (
    with filters as materialized (select public.card_filter_values(upper(coalesce(p_category,''))) categories,
      public.card_filter_values(upper(coalesce(p_rarity,''))) rarities),
    terms as materialized (select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))),'[[:space:]]+') term where term<>''),
    editorial_sources as materialized (
      select m.category,m.source_license from public.catalogue_binder_group_merges m
      join public.catalogue_binder_groups g on g.id=m.group_id and g.enabled
      where 'series:' || g.id::text=chosen and m.source_license is not null
    ), editorial_series as materialized (
      select case when m.old_key like 'series:%' then substring(m.old_key from 8)::uuid end as id
      from public.catalogue_binder_group_merges m
      join public.catalogue_binder_groups g on g.id=m.group_id and g.enabled
      where 'series:' || g.id::text=chosen and m.old_key like 'series:%'
    ), candidate_ids as materialized (
      select f.card_id from editorial_sources s join public.card_franchises f on f.franchise=s.source_license
        join public.cards c on c.id=f.card_id and c.categorie=s.category
      union
      select f.card_id from editorial_series s join public.anime_license_source_rules r on r.binder_id=s.id
        join public.card_franchises f on f.franchise=r.source_license
        join public.cards c on c.id=f.card_id where licensed and c.categorie='ANIME/MANGA'
      union
      select e.card_id from public.anime_series_origin_evidence e
        join public.anime_series_media_rules r on r.media_id=e.media_id
        left join public.anime_license_media_rules n on n.media_id=e.media_id and licensed
        join editorial_series s on s.id=coalesce(n.binder_id,r.binder_id) where enabled
      union
      select f.card_id from public.anime_license_source_rules r join public.card_franchises f on f.franchise=r.source_license
        join public.cards c on c.id=f.card_id where licensed and chosen_id is not null and r.binder_id=chosen_id and c.categorie='ANIME/MANGA'
      union
      select e.card_id from public.anime_series_origin_evidence e join public.anime_series_media_rules r on r.media_id=e.media_id
        left join public.anime_license_media_rules n on n.media_id=e.media_id and licensed
        where enabled and chosen_id is not null and coalesce(n.binder_id,r.binder_id)=chosen_id
      union
      select f.card_id from public.card_franchises f join public.cards c on c.id=f.card_id
        where chosen like 'source:%' and 'source:' || encode(sha256(convert_to(c.categorie || chr(31) || f.franchise,'UTF8')),'hex')=chosen
    ), owned as materialized (
      select card_id,min(date_obtention) as first_obtained,max(date_obtention) as last_obtained
      from public.user_cards where user_id=owner_id group by card_id
    ), catalogue as materialized (
      select c.*,o.card_id is not null as owned,o.first_obtained,o.last_obtained,
        case c.rarete_base::text when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end as rarity_order
      from candidate_ids i join public.cards c on c.id=i.card_id left join owned o on o.card_id=c.id
      where (cardinality((select categories from filters))=0 or upper(btrim(c.categorie))=any(((select categories from filters))::text[]))
        and exists(select 1 from public.catalogue_binder_links l where l.card_id=c.id and l.binder_key=chosen offset 0)
    ), matching as materialized (
      select c.* from catalogue c where (not coalesce(p_owned_only,false) or owned)
        and (cardinality((select rarities from filters))=0 or c.rarete_base::text=any(((select rarities from filters))::text[]))
        and not exists(select 1 from terms t where not (c.nom ilike '%' || t.term || '%'
          or coalesce(c.franchise ilike '%' || t.term || '%',false)
          or exists(select 1 from public.card_franchises n where n.card_id=c.id and n.franchise ilike '%' || t.term || '%')))
    ), ordered as materialized (
      select c.*,row_number() over(order by
        case when ordering='recent' then last_obtained end desc nulls last,
        case when ordering='oldest' then first_obtained end asc nulls last,
        case when ordering='name' then nom end,
        rarity_order,nom,id) as position from matching c
    ), page as (select * from ordered order by position offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60))
    select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nom,'category',categorie,
      'anime',franchise,'rarity',rarete_base,'image',image_url,'owned',owned) order by position) from page),'[]'::jsonb),
      'total',(select count(*) from matching),'binderTotal',(select count(*) from catalogue),'binderOwned',(select count(*) from catalogue where owned))
  );
end $$;

create or replace function public.get_binder_catalogue_page(
  p_query text default '', p_category text default '', p_rarity text default '', p_offset integer default 0, p_limit integer default 24
) returns jsonb language sql stable security definer set search_path = '' as $$
  with filters as materialized (select public.card_filter_values(upper(coalesce(p_category,''))) categories,public.card_filter_values(upper(coalesce(p_rarity,''))) rarities), terms as materialized (
    select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))), '[[:space:]]+') term where term<>''
  ), alias_names as materialized (
    select binder_id,string_agg(alias,chr(31)) as names from public.active_binder_aliases group by binder_id
  ), probe as materialized (select term from terms order by char_length(term) desc,term limit 1),
  matching_media as materialized (
    select r.media_id from public.anime_series_media_rules r
    left join public.anime_license_media_rules n on n.media_id=r.media_id and exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled)
    join public.anime_series_binders b on b.id=coalesce(n.binder_id,r.binder_id)
    left join alias_names a on a.binder_id=b.id cross join probe p
    where b.display_name ilike '%' || p.term || '%' or coalesce(a.names ilike '%' || p.term || '%',false)
  ), matching_license_binders as materialized (
    select b.id from public.anime_license_binders b
    left join alias_names a on a.binder_id=b.id cross join probe p
    where exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled)
      and (b.display_name ilike '%' || p.term || '%' or coalesce(a.names ilike '%' || p.term || '%',false))
  ), matching_licenses as materialized (
    select s.source_license from public.anime_license_source_rules s join matching_license_binders b on b.id=s.binder_id
  ), editorial_keys as materialized (
    select m.old_key,m.category,m.source_license from public.catalogue_binder_groups g
    join public.catalogue_binder_group_merges m on m.group_id=g.id
    left join alias_names a on a.binder_id=g.id cross join probe p
    where g.enabled and (g.display_name ilike '%' || p.term || '%' or coalesce(a.names ilike '%' || p.term || '%',false))
  ), editorial_series as materialized (
    select case when old_key like 'series:%' then substring(old_key from 8)::uuid end as id
    from editorial_keys where old_key like 'series:%'
  ), candidate_cards as materialized (
    select f.card_id as id from editorial_keys k join public.card_franchises f on f.franchise=k.source_license
      join public.cards c on c.id=f.card_id and c.categorie=k.category
    union
    select f.card_id from editorial_series s join public.anime_license_source_rules r on r.binder_id=s.id
      join public.card_franchises f on f.franchise=r.source_license join public.cards c on c.id=f.card_id
      where c.categorie='ANIME/MANGA' and exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled)
    union
    select e.card_id from public.anime_series_origin_evidence e join public.anime_series_media_rules r on r.media_id=e.media_id
      left join public.anime_license_media_rules n on n.media_id=e.media_id
        and exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled)
      join editorial_series s on s.id=coalesce(n.binder_id,r.binder_id)
      where exists(select 1 from public.anime_series_settings where singleton and enabled)
    union
    select c.id from public.cards c where not exists(select 1 from probe)
      or exists(select 1 from probe p where position('%' in p.term)>0 or position('_' in p.term)>0 or position(chr(31) in p.term)>0)
      or exists(select 1 from probe p where c.nom ilike '%' || p.term || '%' or coalesce(c.franchise ilike '%' || p.term || '%',false))
    union select f.card_id from public.card_franchises f cross join probe p where f.franchise ilike '%' || p.term || '%'
    union select ca.card_id from public.anime_series_card_assignments ca join matching_media mm on mm.media_id=ca.media_id
    union select f.card_id from public.card_franchises f join matching_licenses ml on ml.source_license=f.franchise
  ), searchable as materialized (
    select l.card_id,string_agg(l.source_license || chr(31) || l.display_name || chr(31) || coalesce(a.names,''),chr(31)) as names
    from candidate_cards candidate join public.cards raw on raw.id=candidate.id cross join lateral (select links.* from public.catalogue_binder_links links where links.card_id=candidate.id offset 0) l left join alias_names a on a.binder_id=l.series_binder_id
    where exists(select 1 from terms t where not (raw.nom ilike '%' || t.term || '%' or coalesce(raw.franchise ilike '%' || t.term || '%',false))) group by l.card_id
  ), matching as materialized (
    select c.id,c.nom from candidate_cards candidate join public.cards c on c.id=candidate.id left join searchable s on s.card_id=c.id
    where (cardinality((select categories from filters))=0
        or c.categorie=any(((select categories from filters))::text[]))
      and (cardinality((select rarities from filters))=0
        or c.rarete_base::text=any(((select rarities from filters))::text[]))
      and not exists(select 1 from terms t where not (
        c.nom ilike '%' || t.term || '%' or coalesce(c.franchise ilike '%' || t.term || '%',false)
        or coalesce(s.names ilike '%' || t.term || '%',false)
      ))
  ), page_ids as (select id from matching order by nom,id offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60)), page as (select c.* from page_ids p join public.cards c on c.id=p.id)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nom,'category',categorie,
    'anime',franchise,'rarity',rarete_base,'image',image_url,
    'wishlisted',exists(select 1 from public.wishlists w where w.card_id=page.id and w.user_id=auth.uid())) order by nom,id) from page),'[]'::jsonb),'total',(select count(*) from matching));
$$;

notify pgrst,'reload schema';
commit;
