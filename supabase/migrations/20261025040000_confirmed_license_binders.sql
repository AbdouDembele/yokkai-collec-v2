begin;

-- One confirmed license has one visible binder, independently of card origin.
-- The owner explicitly approved regrouping manual/uncertain cards on 2026-10-25.
-- Original card fields, memberships, proofs and player preferences stay intact.
alter table public.anime_series_settings
  add column license_grouping_enabled boolean not null default false,
  add column license_mapping_version text not null default 'unloaded';
alter table public.binder_favorite_preferences add column license_favorite boolean;

create table public.anime_license_binders (
  id uuid primary key references public.anime_series_binders(id),
  display_name text not null check (btrim(display_name)<>'' and char_length(display_name)<=500)
);
create table public.anime_license_source_rules (
  source_license text primary key check (btrim(source_license)<>''),
  binder_id uuid not null references public.anime_license_binders(id)
);
create index anime_license_source_target_idx on public.anime_license_source_rules(binder_id);
create table public.anime_license_media_rules (
  media_id integer primary key references public.anime_series_media_rules(media_id),
  binder_id uuid not null references public.anime_license_binders(id),
  enforce_separation boolean not null default false
);
create table public.anime_license_aliases (
  binder_id uuid not null references public.anime_license_binders(id),
  alias text not null check (btrim(alias)<>'' and char_length(alias)<=500),
  primary key(binder_id,alias)
);
create table public.anime_license_key_redirects (
  old_key text primary key check (old_key ~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$'),
  binder_id uuid not null references public.anime_license_binders(id)
);
do $$ declare relation text; begin
  foreach relation in array array['anime_license_binders','anime_license_source_rules',
    'anime_license_media_rules','anime_license_aliases','anime_license_key_redirects'] loop
    execute format('alter table public.%I enable row level security',relation);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',relation);
    execute format('grant select,insert,update,delete on public.%I to service_role',relation);
  end loop;
end $$;

create function public.canonical_binder_key(p_key text) returns text
language sql stable set search_path='' as $$
  select coalesce((select 'series:' || r.binder_id::text
    from public.anime_license_key_redirects r cross join public.anime_series_settings s
    where s.singleton and s.enabled and s.license_grouping_enabled and r.old_key=p_key),p_key);
$$;
revoke all on function public.canonical_binder_key(text) from public,anon,authenticated,service_role;

create view public.active_binder_aliases with (security_barrier=true) as
select a.binder_id,a.alias from public.anime_license_aliases a
where exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled)
union all
select a.binder_id,a.alias from public.anime_series_aliases a
where not exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled)
  or not exists(select 1 from public.anime_license_aliases n where n.binder_id=a.binder_id);
revoke all on public.active_binder_aliases from public,anon,authenticated,service_role;

create or replace view public.catalogue_binder_links with (security_barrier=true) as
select c.id as card_id,c.categorie as category,l.franchise as source_license,
  case when target.id is not null then 'series:' || target.id::text
    else 'source:' || encode(sha256(convert_to(c.categorie || chr(31) || l.franchise,'UTF8')),'hex') end as binder_key,
  coalesce(case when settings.license_grouping_enabled then licensed.display_name end,b.display_name,l.franchise) as display_name,
  case when target.id is not null then 'series' else 'source' end as origin,
  target.id as series_binder_id
from public.cards c join public.card_franchises l on l.card_id=c.id
left join public.anime_series_settings settings on settings.singleton and settings.enabled
left join public.anime_license_source_rules license_rule on settings.license_grouping_enabled
  and c.categorie='ANIME/MANGA' and license_rule.source_license=l.franchise
left join public.anime_series_protected_cards protected on protected.card_id=c.id
left join public.anime_series_card_assignments a on settings.singleton
  and (settings.license_grouping_enabled or protected.card_id is null)
  and a.card_id=c.id and a.source_license=l.franchise and l.position=0 and c.franchise=l.franchise
  and c.source='anilist' and c.categorie='ANIME/MANGA'
left join lateral (
  select r.binder_id as prior_id,n.binder_id as license_id,coalesce(n.enforce_separation,false) as separate
  from public.anime_series_origin_evidence e
  join public.anime_series_media_rules r on r.media_id=e.media_id and r.decision='A' and r.editorial_approved
  left join public.anime_license_media_rules n on n.media_id=e.media_id
  where a.card_id is not null and e.card_id=a.card_id and e.media_id=a.media_id
    and c.source_id=e.character_id::text
    and (not settings.license_grouping_enabled or license_rule.binder_id is null
      or exists(select 1 from public.anime_license_media_rules exception where exception.media_id=a.media_id and exception.enforce_separation))
    and (e.verified_snapshot-'favoris_count')=(to_jsonb(c)-'favoris_count') limit 1
) proof on true
cross join lateral (select case when settings.license_grouping_enabled then
  coalesce(case when proof.separate then proof.license_id end,license_rule.binder_id,proof.license_id,proof.prior_id)
  else proof.prior_id end as id) target
left join public.anime_series_binders b on b.id=target.id
left join public.anime_license_binders licensed on licensed.id=target.id;

-- No original preference value is overwritten when the owner makes a new
-- license-level choice. Existing exports include this nullable column via to_jsonb.
create or replace function public.set_binder_favorite(p_binder_key text,p_favorite boolean)
returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); chosen text:=public.canonical_binder_key(p_binder_key); licensed boolean;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.get_profile(null);
  if p_favorite is null or not exists(select 1 from public.catalogue_binder_links where binder_key=chosen) then raise exception 'BINDER_NOT_FOUND'; end if;
  select enabled and license_grouping_enabled into licensed from public.anime_series_settings where singleton;
  if licensed then
    insert into public.binder_favorite_preferences(user_id,binder_key,favorite,license_favorite)
    values(viewer,chosen,p_favorite,p_favorite)
    on conflict(user_id,binder_key) do update set license_favorite=excluded.license_favorite;
  else
    insert into public.binder_favorite_preferences(user_id,binder_key,favorite) values(viewer,chosen,p_favorite)
    on conflict(user_id,binder_key) do update set favorite=excluded.favorite;
  end if;
end $$;

create function public.legacy_binder_targets(p_license text,p_category text default null)
returns table(target_key text) language sql stable set search_path='' as $$
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
      and exists(select 1 from public.active_binder_aliases a where a.binder_id=l.series_binder_id and a.alias=p_license)));
$$;
revoke all on function public.legacy_binder_targets(text,text) from public,anon,authenticated,service_role;

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
    select f.license,min(t.target_key) as key,count(distinct t.target_key) as targets
    from public.panini_album_favorites f cross join lateral public.legacy_binder_targets(f.license,null) t
    where f.user_id=p_owner and not exists(select 1 from public.binder_legacy_favorite_resolutions done
      where done.user_id=p_owner and done.license=f.license) group by f.license
  ), legacy as (select distinct c.key from candidates c where c.targets=1),
  keys as (select p.key from folded p union select l.key from legacy l)
  select k.key from keys k left join folded p on p.key=k.key left join legacy l on l.key=k.key
  where coalesce(p.direct_choice,p.redirected_choice,coalesce(p.prior_favorite,false) or l.key is not null);
end $$;

create or replace function public.binder_favorite_conflicts(p_owner uuid)
returns jsonb language sql stable set search_path='' as $$
  with candidates as materialized (
    select f.license,l.binder_key,min(l.display_name) as name,min(l.origin) as origin,
      min(l.category) as category,count(distinct l.card_id) as total
    from public.panini_album_favorites f cross join lateral public.legacy_binder_targets(f.license,null) t
    join public.catalogue_binder_links l on l.binder_key=t.target_key
    where f.user_id=p_owner and not exists(select 1 from public.binder_legacy_favorite_resolutions done
      where done.user_id=p_owner and done.license=f.license) group by f.license,l.binder_key
  ), conflicts as (
    select c.license,jsonb_agg(jsonb_build_object('binderKey',c.binder_key,'license',c.name,'origin',c.origin,
      'category',c.category,'total',c.total) order by c.name,c.binder_key) as candidates
    from candidates c group by c.license having count(*)>1
  ) select coalesce(jsonb_agg(to_jsonb(conflicts) order by license),'[]'::jsonb) from conflicts;
$$;

create or replace function public.resolve_binder_favorite(p_license text,p_binder_keys text[])
returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); candidate text;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.get_profile(null);
  if p_binder_keys is null or cardinality(p_binder_keys)>100 or not exists(
    select 1 from public.panini_album_favorites where user_id=viewer and license=p_license
  ) then raise exception 'BINDER_FAVORITE_INVALID'; end if;
  if exists(select 1 from unnest(p_binder_keys) key where key is null or not exists(
    select 1 from public.legacy_binder_targets(p_license,null) t where t.target_key=public.canonical_binder_key(key)
  )) then raise exception 'BINDER_FAVORITE_INVALID'; end if;
  for candidate in select target_key from public.legacy_binder_targets(p_license,null) loop
    perform public.set_binder_favorite(candidate,exists(select 1 from unnest(p_binder_keys) key
      where public.canonical_binder_key(key)=candidate));
  end loop;
  insert into public.binder_legacy_favorite_resolutions(user_id,license) values(viewer,p_license)
    on conflict(user_id,license) do update set resolved_at=now();
end $$;

-- All RPC signatures and ACLs are retained.
create or replace function public.get_binder_albums_page(
  p_owner_id uuid default null, p_query text default '', p_category text default '',
  p_favorites_only boolean default false, p_offset integer default 0, p_limit integer default 72
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare viewer uuid := auth.uid(); owner_id uuid := coalesce(p_owner_id, auth.uid()); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_view_collection(viewer, owner_id) then raise exception 'PROFILE_PRIVATE'; end if;
  with filters as materialized (select public.card_filter_values(upper(coalesce(p_category,''))) categories), terms as materialized (
    select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))), '[[:space:]]+') term where term <> ''
  ), catalogue as materialized (
    select distinct l.* from public.catalogue_binder_links l
    where cardinality((select categories from filters))=0
      or upper(btrim(l.category))=any(((select categories from filters))::text[])
  ), searchable as materialized (
    select binder_key,string_agg(distinct display_name || chr(31) || source_license,chr(31)) as names
    from catalogue group by binder_key
  ), alias_names as materialized (
    select 'series:' || binder_id::text as binder_key,string_agg(alias,chr(31)) as names
    from public.active_binder_aliases group by binder_id
  ), matching_keys as materialized (
    select s.binder_key from searchable s left join alias_names a using(binder_key) where not exists (
      select 1 from terms t where not (
        s.names ilike '%' || t.term || '%' or coalesce(a.names ilike '%' || t.term || '%',false)
      )
    )
  ), owned as materialized (select distinct card_id from public.user_cards where user_id = owner_id),
  favorites as materialized (select binder_key from public.binder_favorite_keys(owner_id)),
  progress as materialized (
    select l.binder_key, min(l.display_name) as license, min(l.origin) as origin,
      count(distinct l.card_id)::integer as total, count(distinct owned.card_id)::integer as owned,
      exists(select 1 from favorites f where f.binder_key=l.binder_key) as favorite
    from catalogue l left join owned on owned.card_id=l.card_id
    join matching_keys mk on mk.binder_key=l.binder_key group by l.binder_key
  ), filtered as materialized (select * from progress where not coalesce(p_favorites_only,false) or favorite),
  page as (
    select * from filtered order by favorite desc, owned::numeric/nullif(total,0) desc, owned desc, license,binder_key
    offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,72),1),72)
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('binderKey',binder_key,'license',license,'origin',origin,
      'total',total,'owned',owned,'favorite',favorite,'percent',least(100,round(owned::numeric*100/nullif(total,0))))
      order by favorite desc, owned::numeric/nullif(total,0) desc, owned desc,license,binder_key) from page),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'favoriteConflicts',case when viewer=owner_id then public.binder_favorite_conflicts(owner_id) else '[]'::jsonb end,
    'mappingVersion',(select mapping_version || ':' || enabled::text || ':' || license_grouping_enabled::text || ':' || license_mapping_version from public.anime_series_settings where singleton)
  ) into result;
  return result;
end $$;

create or replace function public.get_binder_cards_page(
  p_owner_id uuid, p_binder_key text, p_query text default '', p_category text default '', p_rarity text default '',
  p_owned_only boolean default false, p_offset integer default 0, p_limit integer default 24
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare viewer uuid := auth.uid(); owner_id uuid := coalesce(p_owner_id, auth.uid());
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_view_collection(viewer, owner_id) then raise exception 'PROFILE_PRIVATE'; end if;
  if p_binder_key is null or p_binder_key !~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' then raise exception 'BINDER_KEY_REQUIRED'; end if;
  return (
    with filters as materialized (select public.card_filter_values(upper(coalesce(p_category,''))) categories,public.card_filter_values(upper(coalesce(p_rarity,''))) rarities), terms as materialized (
      select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))), '[[:space:]]+') term where term <> ''
    ), owned as materialized (select distinct card_id from public.user_cards where user_id=owner_id),
    catalogue as materialized (
      select distinct c.*, exists(select 1 from owned o where o.card_id=c.id) as owned
      from public.cards c join public.catalogue_binder_links l on l.card_id=c.id
      where l.binder_key=public.canonical_binder_key(p_binder_key) and (cardinality((select categories from filters))=0
        or upper(btrim(c.categorie))=any(((select categories from filters))::text[]))
    ), matching as materialized (
      select c.* from catalogue c where (not coalesce(p_owned_only,false) or owned)
        and (cardinality((select rarities from filters))=0
          or c.rarete_base::text=any(((select rarities from filters))::text[]))
        and not exists(select 1 from terms t where not (
          c.nom ilike '%' || t.term || '%' or coalesce(c.franchise ilike '%' || t.term || '%',false)
          or exists(select 1 from public.card_franchises names where names.card_id=c.id and names.franchise ilike '%' || t.term || '%')
        ))
    ), page as (select * from matching order by nom,id offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60))
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nom,'category',categorie,'anime',franchise,
        'rarity',rarete_base,'image',image_url,'owned',owned) order by nom,id) from page),'[]'::jsonb),
      'total',(select count(*) from matching),'binderTotal',(select count(*) from catalogue),
      'binderOwned',(select count(*) from catalogue where owned)
    )
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
  ), candidate_cards as materialized (
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

create or replace function public.get_card_binder_metadata(p_card_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(result)), '[]'::jsonb) from (
    select l.card_id, jsonb_agg(distinct jsonb_build_object('key',l.binder_key,'name',l.display_name,'origin',l.origin,
      'searchNames',coalesce((select jsonb_agg(a.alias order by a.alias) from public.active_binder_aliases a where a.binder_id=l.series_binder_id),'[]'::jsonb))) as binders
    from public.catalogue_binder_links l
    where cardinality(p_card_ids) between 1 and 500 and l.card_id=any(p_card_ids)
    group by l.card_id
  ) result;
$$;

create or replace function public.get_profile_binders_page(p_category text,p_query text default '',p_offset integer default 0,p_limit integer default 72)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return (
    with choices as materialized (
      select l.binder_key, min(l.display_name) as license, min(l.origin) as origin
      from public.catalogue_binder_links l where upper(btrim(l.category))=upper(btrim(p_category))
        and (coalesce(p_query,'')='' or l.display_name ilike '%' || btrim(p_query) || '%'
          or l.source_license ilike '%' || btrim(p_query) || '%'
          or exists(select 1 from public.active_binder_aliases a where a.binder_id=l.series_binder_id and a.alias ilike '%' || btrim(p_query) || '%'))
      group by l.binder_key
    ), page as (select * from choices order by license,binder_key offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,72),1),72))
    select jsonb_build_object('items',coalesce((select jsonb_agg(binder_key order by license,binder_key) from page),'[]'::jsonb),
      'labels',coalesce((select jsonb_object_agg(binder_key,license) from page),'{}'::jsonb),
      'origins',coalesce((select jsonb_object_agg(binder_key,origin) from page),'{}'::jsonb),'total',(select count(*) from choices))
  );
end $$;

create or replace function public.resolve_binder_widgets(p_widgets jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare widget jsonb; entry jsonb; entry_value text; chosen text; title text; targets integer;
  entries jsonb; labels jsonb; unresolved jsonb; output jsonb := '[]'::jsonb;
begin
  for widget in select value from jsonb_array_elements(coalesce(p_widgets,'[]'::jsonb)) loop
    entries := '[]'::jsonb; labels := '{}'::jsonb; unresolved := '[]'::jsonb;
    for entry in select item from jsonb_array_elements(widget->'entries') item loop
      entry_value := entry #>> '{}'; chosen := null; title := null;
      if entry_value ~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' then
        chosen := public.canonical_binder_key(entry_value);
        select min(l.display_name) into title from public.catalogue_binder_links l
          where l.binder_key=chosen and upper(btrim(l.category))=widget->>'category';

      else
        select count(distinct l.binder_key),min(l.binder_key),min(l.display_name) into targets,chosen,title
          from public.catalogue_binder_links l join public.legacy_binder_targets(entry_value,widget->>'category') t on t.target_key=l.binder_key;
        if targets <> 1 then chosen := entry_value; title := entry_value; unresolved := unresolved || jsonb_build_array(entry_value); end if;
      end if;
      if not entries @> jsonb_build_array(chosen) then entries := entries || jsonb_build_array(chosen); end if;
      labels := labels || jsonb_build_object(chosen,coalesce(title,'Unavailable binder'));
    end loop;
    output := output || jsonb_build_array(jsonb_build_object('category',widget->>'category','entries',entries,
      'labels',labels,'unresolvedEntries',unresolved));
  end loop;
  return output;
end $$;

notify pgrst,'reload schema';
commit;
