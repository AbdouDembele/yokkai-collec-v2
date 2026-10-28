begin;

-- Required arguments keep the legacy RPCs (including their defaults) unambiguous.
-- Filter before counting/pagination, including cards linked by a secondary licence.
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
  safe_category text := upper(btrim(coalesce(p_category, '')));
  safe_rarity text := upper(btrim(coalesce(p_rarity, '')));
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  if viewer_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not public.can_view_collection(viewer_id, p_friend_id)
    or public.users_blocked(viewer_id, p_friend_id) then
    raise exception 'PROFILE_PRIVATE' using errcode = 'P0001';
  end if;
  if safe_license = '' then raise exception 'INVALID_LICENSE' using errcode = 'P0001'; end if;
  if safe_rarity not in ('', 'C', 'R', 'SR', 'SSR', 'LR') then
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
        and (safe_category = '' or upper(btrim(c.categorie)) = safe_category)
        and (safe_query = '' or c.nom ilike '%' || safe_query || '%')
        and (safe_rarity = '' or c.rarete_base = nullif(safe_rarity, '')::public.card_rarity)
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

-- Reuse the same bounded query for the authenticated player's own binder.
create or replace function public.get_panini_album_cards_page(
  p_license text,
  p_query text,
  p_category text,
  p_owned_only boolean,
  p_offset integer,
  p_limit integer,
  p_rarity text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.get_friend_panini_album_cards_page(
    auth.uid(), p_license, p_query, p_category, p_owned_only,
    p_offset, p_limit, p_rarity
  );
$$;

revoke all on function public.get_friend_panini_album_cards_page(uuid,text,text,text,boolean,integer,integer,text) from public, anon;
revoke all on function public.get_panini_album_cards_page(text,text,text,boolean,integer,integer,text) from public, anon;
grant execute on function public.get_friend_panini_album_cards_page(uuid,text,text,text,boolean,integer,integer,text) to authenticated;
grant execute on function public.get_panini_album_cards_page(text,text,text,boolean,integer,integer,text) to authenticated;

notify pgrst, 'reload schema';
commit;
