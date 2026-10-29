begin;

-- Production audit: avoid scanning all binder aliases once per card. Keep the
-- authoritative views, limits, grouping, search semantics, grants and RLS intact.
CREATE OR REPLACE FUNCTION public.get_card_binder_metadata(p_card_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with links as materialized (
  select l.card_id, l.binder_key, l.display_name, l.origin, l.series_binder_id
  from public.catalogue_binder_links l
  where cardinality(p_card_ids) between 1 and 500
    and l.card_id = any(p_card_ids)
), aliases as materialized (
  select a.binder_id, jsonb_agg(a.alias order by a.alias) as names
  from public.active_binder_aliases a
  join (select distinct series_binder_id from links) wanted
    on wanted.series_binder_id = a.binder_id
  group by a.binder_id
)
select coalesce(jsonb_agg(to_jsonb(result)), '[]'::jsonb) from (
  select l.card_id, jsonb_agg(distinct jsonb_build_object(
    'key', l.binder_key, 'name', l.display_name, 'origin', l.origin,
    'searchNames', coalesce(a.names, '[]'::jsonb)
  )) as binders
  from links l left join aliases a on a.binder_id = l.series_binder_id
  group by l.card_id
) result;
$function$
;

-- Empty search does not need binder/alias candidate expansion. Count exactly,
-- and page by existing card indexes before constructing the returned JSON.
-- Search remains bounded; wide/wildcard queries retain the reference path.
-- No data, index, policy, grant or infrastructure configuration changes.
CREATE OR REPLACE FUNCTION public.get_binder_catalogue_page(p_query text DEFAULT ''::text, p_category text DEFAULT ''::text, p_rarity text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 24, p_sort text DEFAULT 'name'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Empty search pages with existing card indexes. Selective literal searches
-- use trigram candidates and primary-key reads. Keep the original path for
-- short/wildcard searches and for more than 5,000 candidate cards.
select case when btrim(coalesce(p_query,''))='' then (
with filters as materialized(select public.card_filter_values(upper(coalesce(p_category,''))) categories,public.card_filter_values(upper(coalesce(p_rarity,''))) rarities),
selected as materialized (
 (select c.* from public.cards c where p_sort='rarity' and
 (cardinality((select categories from filters))=0 or c.categorie=any(((select categories from filters))::text[])) and
 (cardinality((select rarities from filters))=0 or c.rarete_base::text=any(((select rarities from filters))::text[]))
 order by c.rarete_base desc,c.nom,c.id offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60))
 union all
 (select c.* from public.cards c where p_sort is distinct from 'rarity' and
 (cardinality((select categories from filters))=0 or c.categorie=any(((select categories from filters))::text[])) and
 (cardinality((select rarities from filters))=0 or c.rarete_base::text=any(((select rarities from filters))::text[]))
 order by c.nom,c.id offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60))
)
select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nom,'category',categorie,'anime',franchise,'rarity',rarete_base,'image',image_url,
'wishlisted',exists(select 1 from public.wishlists w where w.card_id=selected.id and w.user_id=auth.uid()))order by case when p_sort='rarity' then rarete_base end desc,nom,id)from selected),'[]'::jsonb),
'total',(select count(*)from public.cards c where
 (cardinality((select categories from filters))=0 or c.categorie=any(((select categories from filters))::text[])) and
 (cardinality((select rarities from filters))=0 or c.rarete_base::text=any(((select rarities from filters))::text[]))))
) else coalesce((
case when char_length(coalesce(p_query,''))>=3
 and position('%' in p_query)=0 and position('_' in p_query)=0 and position(chr(31) in p_query)=0
 and exists(select 1 from regexp_split_to_table(lower(btrim(p_query)),'[[:space:]]+') term where char_length(term)>=3) then (
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
  ), unfiltered_candidates as materialized (
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
    union select c.id from public.cards c cross join probe p where c.nom ilike '%' || p.term || '%'
    union select c.id from public.cards c cross join probe p where c.franchise ilike '%' || p.term || '%'
    union select f.card_id from public.card_franchises f cross join probe p where f.franchise ilike '%' || p.term || '%'
    union select ca.card_id from public.anime_series_card_assignments ca join matching_media mm on mm.media_id=ca.media_id
    union select f.card_id from public.card_franchises f join matching_licenses ml on ml.source_license=f.franchise
  ), candidate_cards as materialized (
 select candidate.id from unfiltered_candidates candidate join public.cards c on c.id=candidate.id
 where (cardinality((select categories from filters))=0 or c.categorie=any(((select categories from filters))::text[]))
 and (cardinality((select rarities from filters))=0 or c.rarete_base::text=any(((select rarities from filters))::text[]))
)
 select case when (select count(*) from candidate_cards)<=5000 then (
 with searchable as materialized (
    select l.card_id,string_agg(l.source_license || chr(31) || l.display_name || chr(31) || coalesce(a.names,''),chr(31)) as names
    from candidate_cards candidate cross join lateral (select raw.* from public.cards raw where raw.id=candidate.id offset 0) raw cross join lateral (select links.* from public.catalogue_binder_links links where links.card_id=candidate.id offset 0) l left join alias_names a on a.binder_id=l.series_binder_id
    where exists(select 1 from terms t where not (raw.nom ilike '%' || t.term || '%' or coalesce(raw.franchise ilike '%' || t.term || '%',false))) group by l.card_id
  ), matching as materialized (
    select c.id,c.nom,c.rarete_base from candidate_cards candidate cross join lateral (select c.* from public.cards c where c.id=candidate.id offset 0) c left join searchable s on s.card_id=c.id
    where (cardinality((select categories from filters))=0
        or c.categorie=any(((select categories from filters))::text[]))
      and (cardinality((select rarities from filters))=0
        or c.rarete_base::text=any(((select rarities from filters))::text[]))
      and not exists(select 1 from terms t where not (
        c.nom ilike '%' || t.term || '%' or coalesce(c.franchise ilike '%' || t.term || '%',false)
        or coalesce(s.names ilike '%' || t.term || '%',false)
      ))
  ), page_ids as (select id from matching order by case when p_sort='rarity' then rarete_base end desc,nom,id offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60)), page as (select c.* from page_ids p join public.cards c on c.id=p.id)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nom,'category',categorie,
    'anime',franchise,'rarity',rarete_base,'image',image_url,
    'wishlisted',exists(select 1 from public.wishlists w where w.card_id=page.id and w.user_id=auth.uid())) order by case when p_sort='rarity' then rarete_base end desc,nom,id) from page),'[]'::jsonb),'total',(select count(*) from matching))
 ) end
) end
),(
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
    select c.id,c.nom,c.rarete_base from candidate_cards candidate join public.cards c on c.id=candidate.id left join searchable s on s.card_id=c.id
    where (cardinality((select categories from filters))=0
        or c.categorie=any(((select categories from filters))::text[]))
      and (cardinality((select rarities from filters))=0
        or c.rarete_base::text=any(((select rarities from filters))::text[]))
      and not exists(select 1 from terms t where not (
        c.nom ilike '%' || t.term || '%' or coalesce(c.franchise ilike '%' || t.term || '%',false)
        or coalesce(s.names ilike '%' || t.term || '%',false)
      ))
  ), page_ids as (select id from matching order by case when p_sort='rarity' then rarete_base end desc,nom,id offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60)), page as (select c.* from page_ids p join public.cards c on c.id=p.id)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nom,'category',categorie,
    'anime',franchise,'rarity',rarete_base,'image',image_url,
    'wishlisted',exists(select 1 from public.wishlists w where w.card_id=page.id and w.user_id=auth.uid())) order by case when p_sort='rarity' then rarete_base end desc,nom,id) from page),'[]'::jsonb),'total',(select count(*) from matching))
)) end;
$function$
;

commit;
