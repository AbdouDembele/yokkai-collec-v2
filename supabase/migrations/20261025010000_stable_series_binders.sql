begin;

-- Additive, inactive installation. Private catalogue proofs are loaded separately.
-- No existing card, source link, collection, favorite or profile is rewritten.
do $$ begin
  if to_regclass('public.global_binder_settings') is not null then
    raise exception 'BINDER_PREVIOUS_PROJECTION_PRESENT';
  end if;
end $$;

create table public.anime_series_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  mapping_version text not null default 'unloaded'
);
insert into public.anime_series_settings default values;
create table public.anime_series_binders (
  id uuid primary key,
  series_media_id integer not null unique check (series_media_id > 0),
  display_name text not null check (btrim(display_name) <> '' and char_length(display_name) <= 200)
);
create table public.anime_series_media_rules (
  media_id integer primary key check (media_id > 0),
  binder_id uuid not null references public.anime_series_binders(id),
  decision text not null check (decision in ('A','B','C','D')),
  editorial_approved boolean not null default false,
  check (not editorial_approved or decision = 'A')
);
create table public.anime_series_protected_cards (
  -- Keep historical exclusions even if an operator removes a catalogue card.
  -- A later restore of the same UUID must not silently lose its protection.
  card_id uuid primary key,
  reason text not null
);
create table public.anime_series_origin_evidence (
  card_id uuid primary key references public.cards(id) on delete cascade,
  character_id integer not null check (character_id > 0),
  media_id integer not null check (media_id > 0),
  verified_snapshot jsonb not null,
  import_evidence_sha256 text not null check (import_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  import_batch_id uuid,
  check (verified_snapshot->>'source' = 'anilist'),
  check (verified_snapshot->>'categorie' = 'ANIME/MANGA'),
  check (verified_snapshot->>'id' = card_id::text),
  check (verified_snapshot->>'source_id' = character_id::text)
);
create table public.anime_series_card_assignments (
  card_id uuid not null references public.anime_series_origin_evidence(card_id) on delete cascade,
  source_license text not null check (btrim(source_license) <> ''),
  media_id integer not null references public.anime_series_media_rules(media_id),
  primary key (card_id, source_license)
);
create index anime_series_assignments_media on public.anime_series_card_assignments(media_id);
create table public.anime_series_aliases (
  binder_id uuid not null references public.anime_series_binders(id),
  alias text not null check (btrim(alias) <> '' and char_length(alias) <= 500),
  primary key (binder_id, alias)
);
create table public.anilist_import_review (
  card_id uuid primary key references public.cards(id) on delete cascade,
  media_id integer,
  batch_id uuid not null,
  reason text not null,
  imported_at timestamptz not null default now()
);

do $$ declare relation text; begin
  foreach relation in array array['anime_series_settings','anime_series_binders','anime_series_media_rules',
    'anime_series_protected_cards','anime_series_origin_evidence','anime_series_card_assignments',
    'anime_series_aliases','anilist_import_review'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', relation);
    execute format('grant select, insert, update, delete on public.%I to service_role', relation);
  end loop;
end $$;

-- This private owner-only view exposes no player data. Clients use the bounded
-- catalogue RPCs below, or owner/friend RPCs with the existing collection ACL.
create view public.catalogue_binder_links with (security_barrier=true) as
select distinct c.id as card_id, c.categorie as category, l.franchise as source_license,
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
left join public.anime_series_origin_evidence e on e.card_id = a.card_id and e.media_id = a.media_id
  -- Popularity is a live aggregate, not import provenance. A player's wishlist
  -- must not silently move a verified card back to its historical binder.
  and c.source_id = e.character_id::text
  and (e.verified_snapshot - 'favoris_count') = (to_jsonb(c) - 'favoris_count')
left join public.anime_series_media_rules r on r.media_id = e.media_id and r.decision = 'A' and r.editorial_approved
left join public.anime_series_binders b on b.id = r.binder_id;
revoke all on public.catalogue_binder_links from public, anon, authenticated, service_role;

create table public.binder_favorite_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  binder_key text not null check (binder_key ~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$'),
  favorite boolean not null,
  created_at timestamptz not null default now(),
  primary key(user_id, binder_key)
);
create table public.binder_legacy_favorite_resolutions (
  user_id uuid not null references auth.users(id) on delete cascade,
  license text not null,
  resolved_at timestamptz not null default now(),
  primary key(user_id, license)
);
create table public.binder_profile_widgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  widgets jsonb not null check (jsonb_typeof(widgets) = 'array')
);
do $$ declare relation text; begin
  foreach relation in array array['binder_favorite_preferences','binder_legacy_favorite_resolutions','binder_profile_widgets'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', relation);
    execute format('grant select, insert, update, delete on public.%I to service_role', relation);
  end loop;
end $$;

create function public.binder_favorite_keys(p_owner uuid)
returns table(binder_key text) language sql stable set search_path = '' as $$
  with candidates as materialized (
    select f.license, min(l.binder_key) as key, count(distinct l.binder_key) as targets
    from public.panini_album_favorites f join public.catalogue_binder_links l
      on l.source_license = f.license or l.display_name = f.license
    where f.user_id = p_owner and not exists (
      select 1 from public.binder_legacy_favorite_resolutions done where done.user_id = p_owner and done.license = f.license
    ) group by f.license
  ), legacy as (select distinct key from candidates where targets = 1)
  select pref.binder_key from public.binder_favorite_preferences pref where pref.user_id = p_owner and pref.favorite
  union
  select legacy.key from legacy where not exists (
    select 1 from public.binder_favorite_preferences pref where pref.user_id = p_owner and pref.binder_key = legacy.key
  );
$$;
revoke all on function public.binder_favorite_keys(uuid) from public, anon, authenticated, service_role;

create function public.binder_favorite_conflicts(p_owner uuid)
returns jsonb language sql stable set search_path = '' as $$
  with candidates as (
    select distinct f.license, l.binder_key, l.display_name, l.origin
    from public.panini_album_favorites f join public.catalogue_binder_links l
      on l.source_license = f.license or l.display_name = f.license
    where f.user_id = p_owner and not exists (
      select 1 from public.binder_legacy_favorite_resolutions done where done.user_id = p_owner and done.license = f.license
    )
  ), conflicts as (
    select license, jsonb_agg(jsonb_build_object('binderKey',binder_key,'license',display_name,'origin',origin)
      order by display_name,binder_key) as candidates
    from candidates group by license having count(*) > 1 order by license limit 100
  ) select coalesce(jsonb_agg(to_jsonb(conflicts)), '[]'::jsonb) from conflicts;
$$;
revoke all on function public.binder_favorite_conflicts(uuid) from public, anon, authenticated, service_role;

create function public.get_binder_albums_page(
  p_owner_id uuid default null, p_query text default '', p_category text default '',
  p_favorites_only boolean default false, p_offset integer default 0, p_limit integer default 72
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare viewer uuid := auth.uid(); owner_id uuid := coalesce(p_owner_id, auth.uid()); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_view_collection(viewer, owner_id) then raise exception 'PROFILE_PRIVATE'; end if;
  with terms as materialized (
    select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))), '[[:space:]]+') term where term <> ''
  ), catalogue as materialized (
    select distinct l.* from public.catalogue_binder_links l
    where cardinality(public.card_filter_values(p_category))=0
      or upper(btrim(l.category))=any(public.card_filter_values(upper(coalesce(p_category,''))))
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

create function public.get_binder_cards_page(
  p_owner_id uuid, p_binder_key text, p_query text default '', p_category text default '', p_rarity text default '',
  p_owned_only boolean default false, p_offset integer default 0, p_limit integer default 24
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare viewer uuid := auth.uid(); owner_id uuid := coalesce(p_owner_id, auth.uid());
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_view_collection(viewer, owner_id) then raise exception 'PROFILE_PRIVATE'; end if;
  if p_binder_key is null or p_binder_key !~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' then raise exception 'BINDER_KEY_REQUIRED'; end if;
  return (
    with terms as materialized (
      select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))), '[[:space:]]+') term where term <> ''
    ), owned as materialized (select distinct card_id from public.user_cards where user_id=owner_id),
    catalogue as materialized (
      select distinct c.*, exists(select 1 from owned o where o.card_id=c.id) as owned
      from public.cards c join public.catalogue_binder_links l on l.card_id=c.id
      where l.binder_key=p_binder_key and (cardinality(public.card_filter_values(p_category))=0
        or upper(btrim(c.categorie))=any(public.card_filter_values(upper(coalesce(p_category,'')))))
    ), matching as materialized (
      select c.* from catalogue c where (not coalesce(p_owned_only,false) or owned)
        and (cardinality(public.card_filter_values(p_rarity))=0
          or c.rarete_base::text=any(public.card_filter_values(upper(coalesce(p_rarity,'')))))
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

create function public.set_binder_favorite(p_binder_key text, p_favorite boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := auth.uid();
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.get_profile(null);
  if p_favorite is null or not exists(select 1 from public.catalogue_binder_links where binder_key=p_binder_key) then raise exception 'BINDER_NOT_FOUND'; end if;
  insert into public.binder_favorite_preferences(user_id,binder_key,favorite) values(viewer,p_binder_key,p_favorite)
  on conflict(user_id,binder_key) do update set favorite=excluded.favorite;
end $$;

create function public.resolve_binder_favorite(p_license text, p_binder_keys text[])
returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := auth.uid(); candidate text;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.get_profile(null);
  if p_binder_keys is null or cardinality(p_binder_keys)>100 or not exists(
    select 1 from public.panini_album_favorites where user_id=viewer and license=p_license
  ) then raise exception 'BINDER_FAVORITE_INVALID'; end if;
  if exists(select 1 from unnest(p_binder_keys) key where key is null or not exists(
    select 1 from public.catalogue_binder_links l where l.binder_key=key and (l.source_license=p_license or l.display_name=p_license)
  )) then raise exception 'BINDER_FAVORITE_INVALID'; end if;
  for candidate in select distinct binder_key from public.catalogue_binder_links where source_license=p_license or display_name=p_license loop
    insert into public.binder_favorite_preferences(user_id,binder_key,favorite) values(viewer,candidate,candidate=any(p_binder_keys))
    on conflict(user_id,binder_key) do update set favorite=excluded.favorite;
  end loop;
  insert into public.binder_legacy_favorite_resolutions(user_id,license) values(viewer,p_license)
  on conflict(user_id,license) do update set resolved_at=now();
end $$;

-- Public catalogue data only. No ownership, profile, evidence or preferences.
create function public.get_card_binder_metadata(p_card_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(result)), '[]'::jsonb) from (
    select l.card_id, jsonb_agg(distinct jsonb_build_object('key',l.binder_key,'name',l.display_name,'origin',l.origin,
      'searchNames',coalesce((select jsonb_agg(a.alias order by a.alias) from public.anime_series_aliases a where a.binder_id=l.series_binder_id),'[]'::jsonb))) as binders
    from public.catalogue_binder_links l
    where cardinality(p_card_ids) between 1 and 500 and l.card_id=any(p_card_ids)
    group by l.card_id
  ) result;
$$;
create function public.get_binder_catalogue_totals()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(result) order by result.license,result."binderKey"),'[]'::jsonb) from (
    select l.binder_key as "binderKey", min(l.display_name) as license, min(l.origin) as origin,
      count(distinct l.card_id)::integer as total from public.catalogue_binder_links l group by l.binder_key
  ) result;
$$;
create function public.get_binder_catalogue_page(
  p_query text default '', p_category text default '', p_rarity text default '', p_offset integer default 0, p_limit integer default 24
) returns jsonb language sql stable security definer set search_path = '' as $$
  with terms as materialized (
    select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))), '[[:space:]]+') term where term<>''
  ), alias_names as materialized (
    select binder_id,string_agg(alias,chr(31)) as names from public.anime_series_aliases group by binder_id
  ), searchable as materialized (
    select l.card_id,string_agg(l.source_license || chr(31) || l.display_name || chr(31) || coalesce(a.names,''),chr(31)) as names
    from public.catalogue_binder_links l left join alias_names a on a.binder_id=l.series_binder_id
    where exists(select 1 from terms) group by l.card_id
  ), matching as materialized (
    select c.* from public.cards c left join searchable s on s.card_id=c.id
    where (cardinality(public.card_filter_values(p_category))=0
        or c.categorie=any(public.card_filter_values(upper(coalesce(p_category,'')))))
      and (cardinality(public.card_filter_values(p_rarity))=0
        or c.rarete_base::text=any(public.card_filter_values(upper(coalesce(p_rarity,'')))))
      and not exists(select 1 from terms t where not (
        c.nom ilike '%' || t.term || '%' or coalesce(c.franchise ilike '%' || t.term || '%',false)
        or coalesce(s.names ilike '%' || t.term || '%',false)
      ))
  ), page as (select * from matching order by nom,id offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,24),1),60))
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',nom,'category',categorie,
    'anime',franchise,'rarity',rarete_base,'image',image_url,
    'wishlisted',exists(select 1 from public.wishlists w where w.card_id=page.id and w.user_id=auth.uid())) order by nom,id) from page),'[]'::jsonb),'total',(select count(*) from matching));
$$;

revoke all on function public.get_binder_albums_page(uuid,text,text,boolean,integer,integer),
  public.get_binder_cards_page(uuid,text,text,text,text,boolean,integer,integer), public.set_binder_favorite(text,boolean),
  public.resolve_binder_favorite(text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_binder_albums_page(uuid,text,text,boolean,integer,integer),
  public.get_binder_cards_page(uuid,text,text,text,text,boolean,integer,integer), public.set_binder_favorite(text,boolean),
  public.resolve_binder_favorite(text,text[]) to authenticated;
revoke all on function public.get_card_binder_metadata(uuid[]), public.get_binder_catalogue_totals(),
  public.get_binder_catalogue_page(text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_card_binder_metadata(uuid[]), public.get_binder_catalogue_totals(),
  public.get_binder_catalogue_page(text,text,text,integer,integer) to anon,authenticated;

commit;
