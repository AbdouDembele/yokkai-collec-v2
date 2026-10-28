-- Visitor-facing binders use the viewed player's favorites, before pagination.
-- Keep the same privacy gate and authenticated-only RPC as before.
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
  safe_category text := upper(btrim(coalesce(p_category, '')));
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
      where safe_category = '' or upper(btrim(c.categorie)) = safe_category
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

revoke all on function public.get_friend_panini_albums_page(uuid,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_friend_panini_albums_page(uuid,text,text,integer,integer) to authenticated;
