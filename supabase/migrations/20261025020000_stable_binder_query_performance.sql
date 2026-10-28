begin;

-- Retain exact provenance checks, protected UUIDs, source memberships and ACLs.
-- Probe the unique proof by card UUID instead of hashing complete JSON snapshots.
-- All joined IDs are unique; one row per (card_id, source_license) is preserved.
create or replace view public.catalogue_binder_links with (security_barrier=true) as
select c.id as card_id, c.categorie as category, l.franchise as source_license,
  case when b.id is not null then 'series:' || b.id::text
    else 'source:' || encode(sha256(convert_to(c.categorie || chr(31) || l.franchise, 'UTF8')), 'hex') end as binder_key,
  coalesce(b.display_name, l.franchise) as display_name,
  case when b.id is not null then 'series' else 'source' end as origin,
  b.id as series_binder_id
from public.cards c join public.card_franchises l on l.card_id = c.id
left join public.anime_series_settings settings on settings.singleton and settings.enabled
left join public.anime_series_protected_cards protected on protected.card_id = c.id
left join public.anime_series_card_assignments a on settings.singleton and protected.card_id is null
  and a.card_id = c.id and a.source_license = l.franchise and l.position = 0 and c.franchise = l.franchise
  and c.source = 'anilist' and c.categorie = 'ANIME/MANGA'
left join lateral (
 select r.binder_id from public.anime_series_origin_evidence e
 join public.anime_series_media_rules r on r.media_id=e.media_id and r.decision='A' and r.editorial_approved
 where a.card_id is not null and e.card_id=a.card_id and e.media_id=a.media_id
 and c.source_id=e.character_id::text
 and (e.verified_snapshot-'favoris_count')=(to_jsonb(c)-'favoris_count') limit 1
 ) proof on true
 left join public.anime_series_binders b on b.id=proof.binder_id;


-- Parse filter arrays once per request, rather than once per catalogue row.
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
    from public.anime_series_aliases group by binder_id
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
    'mappingVersion',(select mapping_version || ':' || enabled::text from public.anime_series_settings where singleton)
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
      where l.binder_key=p_binder_key and (cardinality((select categories from filters))=0
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

-- Names select candidates only. Final matching still uses the verified live
-- projection, including protected/manual/stale-card exclusions and all terms.
-- Keep only IDs/names until pagination, avoiding full-card spill to disk.
create or replace function public.get_binder_catalogue_page(
  p_query text default '', p_category text default '', p_rarity text default '', p_offset integer default 0, p_limit integer default 24
) returns jsonb language sql stable security definer set search_path = '' as $$
  with filters as materialized (select public.card_filter_values(upper(coalesce(p_category,''))) categories,public.card_filter_values(upper(coalesce(p_rarity,''))) rarities), terms as materialized (
    select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))), '[[:space:]]+') term where term<>''
  ), alias_names as materialized (
    select binder_id,string_agg(alias,chr(31)) as names from public.anime_series_aliases group by binder_id
  ), probe as materialized (select term from terms order by char_length(term) desc,term limit 1),
  matching_media as materialized (
    select r.media_id from public.anime_series_media_rules r join public.anime_series_binders b on b.id=r.binder_id
    left join alias_names a on a.binder_id=b.id cross join probe p
    where b.display_name ilike '%' || p.term || '%' or coalesce(a.names ilike '%' || p.term || '%',false)
  ), candidate_cards as materialized (
    select c.id from public.cards c where not exists(select 1 from probe)
      or exists(select 1 from probe p where position('%' in p.term)>0 or position('_' in p.term)>0 or position(chr(31) in p.term)>0)
      or exists(select 1 from probe p where c.nom ilike '%' || p.term || '%' or coalesce(c.franchise ilike '%' || p.term || '%',false))
    union select f.card_id from public.card_franchises f cross join probe p where f.franchise ilike '%' || p.term || '%'
    union select ca.card_id from public.anime_series_card_assignments ca join matching_media mm on mm.media_id=ca.media_id
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
