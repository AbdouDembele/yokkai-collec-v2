begin;

create function public.get_friend_panini_albums_page(
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
  if viewer_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.can_view_collection(viewer_id, p_friend_id) then
    raise exception 'PROFILE_PRIVATE' using errcode = 'P0001';
  end if;

  return (
    with catalogue as materialized (
      select
        c.id,
        case
          when upper(btrim(c.categorie)) in (
            'ARTIST', 'DISNEY CHANNEL', 'FILM',
            'INTERNET PERSONALITY', 'KPOP', 'WWE'
          ) then upper(btrim(c.categorie))
          else btrim(c.franchise)
        end as license
      from public.cards c
      where safe_category = '' or upper(btrim(c.categorie)) = safe_category
    ),
    owned as materialized (
      select distinct uc.card_id
      from public.user_cards uc
      where uc.user_id = p_friend_id
    ),
    progress as materialized (
      select
        catalogue.license,
        count(*)::integer as total,
        count(owned.card_id)::integer as owned
      from catalogue
      left join owned on owned.card_id = catalogue.id
      where catalogue.license <> ''
        and (safe_query = '' or catalogue.license ilike '%' || safe_query || '%')
      group by catalogue.license
    ),
    selected as (
      select progress.*, count(*) over()::integer as album_count
      from progress
      order by
        (progress.owned::numeric / nullif(progress.total, 0)) desc,
        progress.owned desc,
        progress.license
      offset safe_offset
      limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'license', selected.license,
        'total', selected.total,
        'owned', selected.owned,
        'percent', least(100, round(selected.owned::numeric * 100 / nullif(selected.total, 0)))
      ) order by
        (selected.owned::numeric / nullif(selected.total, 0)) desc,
        selected.owned desc,
        selected.license), '[]'::jsonb),
      'total', coalesce(max(selected.album_count), 0)
    )
    from selected
  );
end;
$$;

create function public.get_friend_panini_album_cards_page(
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
  if viewer_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.can_view_collection(viewer_id, p_friend_id) then
    raise exception 'PROFILE_PRIVATE' using errcode = 'P0001';
  end if;
  if safe_license = '' then
    raise exception 'INVALID_LICENSE' using errcode = 'P0001';
  end if;

  return (
    with matching as materialized (
      select
        c.id,
        c.nom,
        c.categorie,
        c.franchise,
        c.rarete_base,
        c.image_url,
        exists (
          select 1
          from public.user_cards uc
          where uc.user_id = p_friend_id and uc.card_id = c.id
        ) as owned
      from public.cards c
      where case
          when upper(btrim(c.categorie)) in (
            'ARTIST', 'DISNEY CHANNEL', 'FILM',
            'INTERNET PERSONALITY', 'KPOP', 'WWE'
          ) then upper(btrim(c.categorie)) = upper(safe_license)
          else btrim(c.franchise) = safe_license
        end
        and (safe_category = '' or upper(btrim(c.categorie)) = safe_category)
        and (safe_query = '' or c.nom ilike '%' || safe_query || '%')
    ),
    selected as (
      select matching.*, count(*) over()::integer as card_count
      from matching
      where not coalesce(p_owned_only, false) or matching.owned
      order by matching.nom, matching.id
      offset safe_offset
      limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', selected.id,
        'name', selected.nom,
        'category', selected.categorie,
        'anime', selected.franchise,
        'rarity', selected.rarete_base,
        'image', selected.image_url,
        'owned', selected.owned
      ) order by selected.nom, selected.id), '[]'::jsonb),
      'total', coalesce(max(selected.card_count), 0)
    )
    from selected
  );
end;
$$;

revoke all on function public.get_friend_panini_albums_page(uuid,text,text,integer,integer),
  public.get_friend_panini_album_cards_page(uuid,text,text,text,boolean,integer,integer)
  from public, anon, authenticated;
grant execute on function public.get_friend_panini_albums_page(uuid,text,text,integer,integer),
  public.get_friend_panini_album_cards_page(uuid,text,text,text,boolean,integer,integer)
  to authenticated;

commit;
