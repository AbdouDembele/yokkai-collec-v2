begin;

-- One catalogue projection serves progress, search, favorites and conflicts.
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
    ), targets as materialized (
      select * from configured
      union select f.license,n.binder_key from unresolved f join names n on n.source_license=f.license
      union select f.license,n.binder_key from unresolved f join names n on n.display_name=f.license
      union select f.license,n.binder_key from unresolved f join public.active_binder_aliases a on a.alias=f.license
        join names n on n.series_binder_id=a.binder_id where (select licensed from settings)
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

-- The old eight-argument RPC remains available for deployed clients. The new
-- overload carries the selected sort to SQL, before pagination.
create function public.get_binder_cards_page(
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
    candidate_ids as materialized (
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
revoke all on function public.get_binder_cards_page(uuid,text,text,text,text,boolean,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_binder_cards_page(uuid,text,text,text,text,boolean,integer,integer,text) to authenticated;

create or replace function public.get_binder_cards_page(
  p_owner_id uuid,p_binder_key text,p_query text default '',p_category text default '',p_rarity text default '',
  p_owned_only boolean default false,p_offset integer default 0,p_limit integer default 24
) returns jsonb language sql stable security definer set search_path='' as $$
  select public.get_binder_cards_page(p_owner_id,p_binder_key,p_query,p_category,p_rarity,p_owned_only,p_offset,p_limit,'rarity');
$$;

notify pgrst,'reload schema';
commit;
