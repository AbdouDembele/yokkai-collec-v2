begin;

create table public.panini_album_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  license text not null check (btrim(license) <> '' and char_length(license) <= 200),
  created_at timestamptz not null default now(),
  primary key (user_id, license)
);

alter table public.panini_album_favorites enable row level security;
revoke all on table public.panini_album_favorites from public, anon, authenticated;
grant select, insert, delete on table public.panini_album_favorites to authenticated;
grant all on table public.panini_album_favorites to service_role;

create policy panini_album_favorites_own on public.panini_album_favorites
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.get_panini_albums_page(
  p_query text default '',
  p_category text default '',
  p_offset integer default 0,
  p_limit integer default 72
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
  safe_category text := upper(btrim(coalesce(p_category, '')));
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
      where safe_category = '' or upper(btrim(c.categorie)) = safe_category
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

create or replace function public.get_panini_album_cards_page(
  p_license text,
  p_query text default '',
  p_category text default '',
  p_owned_only boolean default false,
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
  player_id uuid := auth.uid();
  safe_license text := btrim(coalesce(p_license, ''));
  safe_query text := btrim(coalesce(p_query, ''));
  safe_category text := upper(btrim(coalesce(p_category, '')));
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if safe_license = '' then raise exception 'INVALID_LICENSE' using errcode = 'P0001'; end if;

  return (
    with matching as materialized (
      select c.id, c.nom, c.categorie, c.franchise, c.rarete_base, c.image_url,
        exists (select 1 from public.user_cards uc
          where uc.user_id = player_id and uc.card_id = c.id) as owned
      from public.cards c
      where exists (select 1 from public.card_franchises links
          where links.card_id = c.id and links.franchise = safe_license)
        and (safe_category = '' or upper(btrim(c.categorie)) = safe_category)
        and (safe_query = '' or c.nom ilike '%' || safe_query || '%')
    ),
    selected as (
      select matching.*, count(*) over()::integer as card_count
      from matching
      where not coalesce(p_owned_only, false) or matching.owned
      order by case matching.rarete_base
          when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2
          when 'R' then 3 when 'C' then 4 else 5 end,
        matching.nom, matching.id
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
      'total', coalesce(max(selected.card_count), 0)
    ) from selected
  );
end;
$$;

create or replace function public.get_friend_panini_album_cards_page(
  p_friend_id uuid,
  p_license text,
  p_query text default '',
  p_category text default '',
  p_owned_only boolean default false,
  p_offset integer default 0,
  p_limit integer default 24
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
  safe_category text := upper(btrim(coalesce(p_category, '')));
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  if viewer_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not public.can_view_collection(viewer_id, p_friend_id) then
    raise exception 'PROFILE_PRIVATE' using errcode = 'P0001';
  end if;
  if safe_license = '' then raise exception 'INVALID_LICENSE' using errcode = 'P0001'; end if;

  return (
    with matching as materialized (
      select c.id, c.nom, c.categorie, c.franchise, c.rarete_base, c.image_url,
        exists (select 1 from public.user_cards uc
          where uc.user_id = p_friend_id and uc.card_id = c.id) as owned
      from public.cards c
      where exists (select 1 from public.card_franchises links
          where links.card_id = c.id and links.franchise = safe_license)
        and (safe_category = '' or upper(btrim(c.categorie)) = safe_category)
        and (safe_query = '' or c.nom ilike '%' || safe_query || '%')
    ),
    selected as (
      select matching.*, count(*) over()::integer as card_count from matching
      where not coalesce(p_owned_only, false) or matching.owned
      order by case matching.rarete_base
          when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2
          when 'R' then 3 when 'C' then 4 else 5 end,
        matching.nom, matching.id
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
      'total', coalesce(max(selected.card_count), 0)
    ) from selected
  );
end;
$$;

commit;
