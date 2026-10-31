begin;
set local lock_timeout='3s';
CREATE OR REPLACE FUNCTION public.get_binder_albums_page(p_owner_id uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text, p_category text DEFAULT ''::text, p_favorites_only boolean DEFAULT false, p_offset integer DEFAULT 0, p_limit integer DEFAULT 72)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      select l.* from public.catalogue_binder_links l
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
      select s.*,coalesce(pop.favorite_count,0) as popularity,exists(select 1 from favorite_keys f where f.key=s.binder_key) as favorite
      from stats s left join (select * from public.binder_popularity_counts('stable') where viewer=owner_id) pop using(binder_key) left join searchable n using(binder_key) left join alias_names a using(binder_key)
      where (cardinality((select categories from filters))=0 or upper(btrim(s.category))=any(((select categories from filters))::text[]))
        and not exists(select 1 from terms t where not (n.names ilike '%' || t.term || '%' or coalesce(a.names ilike '%' || t.term || '%',false)))
    ), filtered as materialized (select * from progress where not coalesce(p_favorites_only,false) or favorite),
    page as (select * from filtered order by favorite desc,popularity desc,owned::numeric/nullif(total,0) desc,owned desc,license,binder_key
      offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,72),1),72))
     , covers as materialized (
          select distinct on (l.binder_key) l.binder_key,c.image_url as image
          from catalogue l join page p using(binder_key) join public.cards c on c.id=l.card_id
          where nullif(btrim(c.image_url),'') is not null
          order by l.binder_key,
            case c.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,c.id
        )
        select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('binderKey',binder_key,
          'image',(select image from covers where covers.binder_key=page.binder_key),
      'license',license,'origin',origin,'total',total,'owned',owned,'favorite',favorite,
      'percent',least(100,round(owned::numeric*100/nullif(total,0))))
      order by favorite desc,popularity desc,owned::numeric/nullif(total,0) desc,owned desc,license,binder_key) from page),'[]'::jsonb),
      'total',(select count(*) from filtered),
      'favoriteConflicts',case when viewer=owner_id then coalesce((select jsonb_agg(to_jsonb(c) order by license) from conflicts c),'[]'::jsonb) else '[]'::jsonb end,
      'mappingVersion',(select mapping_version || ':' || enabled::text || ':' || license_grouping_enabled::text || ':' || license_mapping_version from settings))
  );
end $function$;
notify pgrst,'reload schema';
commit;
