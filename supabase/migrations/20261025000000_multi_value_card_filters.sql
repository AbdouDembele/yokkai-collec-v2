begin;

-- Card filters accept several values without changing RPC signatures:
-- '' = no filter, 'SR' = one value (legacy), '["SR","SSR"]' = several values.
create or replace function public.card_filter_values(p_value text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when btrim(coalesce(p_value, '')) = '' then '{}'::text[]
    when left(btrim(p_value), 1) = '[' then coalesce((
      select array_agg(distinct btrim(value))
      from jsonb_array_elements_text(btrim(p_value)::jsonb) as value
      where btrim(value) <> ''
    ), '{}'::text[])
    else array[btrim(p_value)]
  end;
$$;

revoke all on function public.card_filter_values(text) from public;
grant execute on function public.card_filter_values(text)
  to anon, authenticated, service_role;

create or replace function public.get_catalogue_cards_page(
  p_query text default '',
  p_category text default '',
  p_rarity text default '',
  p_offset integer default 0,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_query text := btrim(coalesce(p_query, ''));
  safe_categories text[] := public.card_filter_values(p_category);
  safe_rarities text[] := public.card_filter_values(upper(coalesce(p_rarity, '')));
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  return (
    with terms as materialized (
      select term
      from regexp_split_to_table(lower(safe_query), '[[:space:]]+') as term
      where term <> ''
    ),
    matching as materialized (
      select c.id, c.nom, c.categorie, c.franchise, c.rarete_base, c.image_url
      from public.cards c
      where (cardinality(safe_categories) = 0 or c.categorie = any(safe_categories))
        and (cardinality(safe_rarities) = 0 or c.rarete_base::text = any(safe_rarities))
        and not exists (
          select 1
          from terms
          where not (
            c.nom ilike '%' || terms.term || '%'
            or coalesce(c.franchise ilike '%' || terms.term || '%', false)
            or exists (
              select 1
              from public.card_franchises links
              where links.card_id = c.id
                and links.franchise ilike '%' || terms.term || '%'
            )
          )
        )
    ),
    selected as (
      select *
      from matching
      order by nom, id
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', selected.id,
          'name', selected.nom,
          'category', selected.categorie,
          'anime', selected.franchise,
          'rarity', selected.rarete_base,
          'image', selected.image_url
        ) order by selected.nom, selected.id)
        from selected
      ), '[]'::jsonb),
      'total', (select count(*) from matching)
    )
  );
end;
$$;

create or replace function public.get_panini_albums_page(
  p_query text default '',
  p_category text default '',
  p_offset integer default 0,
  p_limit integer default 72,
  p_favorites_only boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  safe_query text := btrim(coalesce(p_query, ''));
  safe_categories text[] := public.card_filter_values(upper(coalesce(p_category, '')));
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 72), 1), 72);
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  return (
    with catalogue as materialized (
      select c.id, links.franchise as license
      from public.cards c
      join public.card_franchises links on links.card_id = c.id
      where cardinality(safe_categories) = 0 or upper(btrim(c.categorie)) = any(safe_categories)
    ),
    owned as materialized (
      select distinct uc.card_id
      from public.user_cards uc
      where uc.user_id = player_id
    ),
    progress as materialized (
      select catalogue.license, count(*)::integer as total,
        count(owned.card_id)::integer as owned,
        exists (
          select 1 from public.panini_album_favorites favorite
          where favorite.user_id = player_id
            and favorite.license = catalogue.license
        ) as favorite
      from catalogue
      left join owned on owned.card_id = catalogue.id
      where safe_query = '' or catalogue.license ilike '%' || safe_query || '%'
      group by catalogue.license
    ),
    selected as (
      select progress.*, count(*) over()::integer as album_count
      from progress
      where not coalesce(p_favorites_only, false) or progress.favorite
      order by progress.favorite desc,
        (progress.owned::numeric / nullif(progress.total, 0)) desc,
        progress.owned desc, progress.license
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'license', selected.license, 'total', selected.total,
        'owned', selected.owned, 'favorite', selected.favorite,
        'percent', least(100, round(selected.owned::numeric * 100 / nullif(selected.total, 0)))
      ) order by selected.favorite desc,
        (selected.owned::numeric / nullif(selected.total, 0)) desc,
        selected.owned desc, selected.license), '[]'::jsonb),
      'total', coalesce(max(selected.album_count), 0)
    ) from selected
  );
end;
$$;

create or replace function public.get_friend_panini_albums_page(
  p_friend_id uuid,
  p_query text default '',
  p_category text default '',
  p_offset integer default 0,
  p_limit integer default 72
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
  safe_query text := btrim(coalesce(p_query, ''));
  safe_categories text[] := public.card_filter_values(upper(coalesce(p_category, '')));
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 72), 1), 72);
begin
  if viewer_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not public.can_view_collection(viewer_id, p_friend_id) then
    raise exception 'PROFILE_PRIVATE' using errcode = 'P0001';
  end if;

  return (
    with catalogue as materialized (
      select c.id, links.franchise as license
      from public.cards c
      join public.card_franchises links on links.card_id = c.id
      where cardinality(safe_categories) = 0 or upper(btrim(c.categorie)) = any(safe_categories)
    ),
    owned as materialized (
      select distinct uc.card_id from public.user_cards uc where uc.user_id = p_friend_id
    ),
    progress as materialized (
      select catalogue.license, count(*)::integer as total,
        count(owned.card_id)::integer as owned,
        exists (
          select 1 from public.panini_album_favorites favorites
          where favorites.user_id = p_friend_id and favorites.license = catalogue.license
        ) as favorite
      from catalogue left join owned on owned.card_id = catalogue.id
      where safe_query = '' or catalogue.license ilike '%' || safe_query || '%'
      group by catalogue.license
    ),
    selected as (
      select progress.*, count(*) over()::integer as album_count from progress
      order by progress.favorite desc,
        (progress.owned::numeric / nullif(progress.total, 0)) desc,
        progress.owned desc, progress.license
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'license', selected.license, 'total', selected.total,
        'owned', selected.owned, 'favorite', selected.favorite,
        'percent', least(100, round(selected.owned::numeric * 100 / nullif(selected.total, 0)))
      ) order by selected.favorite desc,
        (selected.owned::numeric / nullif(selected.total, 0)) desc,
        selected.owned desc, selected.license), '[]'::jsonb),
      'total', coalesce(max(selected.album_count), 0)
    ) from selected
  );
end;
$$;

create or replace function public.get_friend_panini_album_cards_page(
  p_friend_id uuid,
  p_license text,
  p_query text,
  p_category text,
  p_owned_only boolean,
  p_offset integer,
  p_limit integer,
  p_rarity text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
  safe_license text := btrim(coalesce(p_license, ''));
  safe_query text := btrim(coalesce(p_query, ''));
  safe_categories text[] := public.card_filter_values(upper(coalesce(p_category, '')));
  safe_rarities text[] := public.card_filter_values(upper(coalesce(p_rarity, '')));
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  if viewer_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not public.can_view_collection(viewer_id, p_friend_id)
    or public.users_blocked(viewer_id, p_friend_id) then
    raise exception 'PROFILE_PRIVATE' using errcode = 'P0001';
  end if;
  if safe_license = '' then raise exception 'INVALID_LICENSE' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(safe_rarities) as value
      where value not in ('C', 'R', 'SR', 'SSR', 'LR')) then
    raise exception 'INVALID_RARITY' using errcode = 'P0001';
  end if;

  return (
    with matching as materialized (
      select c.id, c.nom, c.categorie, c.franchise, c.rarete_base, c.image_url,
        exists (select 1 from public.user_cards uc
          where uc.user_id = p_friend_id and uc.card_id = c.id) as owned
      from public.cards c
      where exists (select 1 from public.card_franchises links
          where links.card_id = c.id and links.franchise = safe_license)
        and (cardinality(safe_categories) = 0 or upper(btrim(c.categorie)) = any(safe_categories))
        and (safe_query = '' or c.nom ilike '%' || safe_query || '%')
        and (cardinality(safe_rarities) = 0 or c.rarete_base::text = any(safe_rarities))
    ),
    eligible as materialized (
      select * from matching
      where not coalesce(p_owned_only, false) or matching.owned
    ),
    selected as (
      select * from eligible
      order by case rarete_base
          when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2
          when 'R' then 3 when 'C' then 4 else 5 end,
        nom, id
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', selected.id, 'name', selected.nom, 'category', selected.categorie,
        'anime', selected.franchise, 'rarity', selected.rarete_base,
        'image', selected.image_url, 'owned', selected.owned
      ) order by case selected.rarete_base
          when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2
          when 'R' then 3 when 'C' then 4 else 5 end,
        selected.nom, selected.id), '[]'::jsonb),
      'total', (select count(*)::integer from eligible)
    ) from selected
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
