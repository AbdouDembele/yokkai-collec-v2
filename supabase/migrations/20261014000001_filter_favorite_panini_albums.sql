begin;

drop function if exists public.get_panini_albums_page(text, text, integer, integer);
drop function if exists public.get_panini_albums_page(text, text, integer, integer, boolean);

create function public.get_panini_albums_page(
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

revoke all on function public.get_panini_albums_page(text, text, integer, integer, boolean)
  from public, anon;
grant execute on function public.get_panini_albums_page(text, text, integer, integer, boolean)
  to authenticated, service_role;

commit;
