begin;

create table public.card_franchises (
  card_id uuid not null references public.cards(id) on delete cascade,
  franchise text not null check (btrim(franchise) <> ''),
  position smallint not null check (position >= 0 and position < 10),
  primary key (card_id, position)
);

create unique index card_franchises_card_name_idx
  on public.card_franchises (card_id, lower(btrim(franchise)));
create index card_franchises_name_idx
  on public.card_franchises (franchise);

alter table public.card_franchises enable row level security;
revoke all on table public.card_franchises from public, anon, authenticated;
grant select on table public.card_franchises to anon, authenticated;
grant all on table public.card_franchises to service_role;
grant insert, update, delete on table public.card_franchises to authenticated;

create policy card_franchises_read_catalogue on public.card_franchises
  for select to anon, authenticated using (true);
create policy card_franchises_admin_all on public.card_franchises
  for all to authenticated
  using ((select public.is_current_user_admin()))
  with check ((select public.is_current_user_admin()));

create function public.normalize_card_franchise_link_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.franchise := public.normalize_card_franchise(new.franchise);
  return new;
end;
$$;

create trigger card_franchises_normalize_before_write
before insert or update of franchise on public.card_franchises
for each row execute function public.normalize_card_franchise_link_before_write();

revoke all on function public.normalize_card_franchise_link_before_write()
  from public, anon, authenticated;

create function public.add_default_card_franchise_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_franchise text := case
    when upper(btrim(new.categorie)) in (
      'ARTIST', 'DISNEY CHANNEL', 'FILM',
      'INTERNET PERSONALITY', 'KPOP', 'WWE'
    ) then upper(btrim(new.categorie))
    else btrim(new.franchise)
  end;
begin
  if default_franchise <> '' then
    insert into public.card_franchises(card_id, franchise, position)
    values (new.id, default_franchise, 0);
  end if;
  return new;
end;
$$;

create trigger cards_add_default_franchise_after_insert
after insert on public.cards
for each row execute function public.add_default_card_franchise_after_insert();

revoke all on function public.add_default_card_franchise_after_insert()
  from public, anon, authenticated;

insert into public.card_franchises(card_id, franchise, position)
select
  cards.id,
  case
    when upper(btrim(cards.categorie)) in (
      'ARTIST', 'DISNEY CHANNEL', 'FILM',
      'INTERNET PERSONALITY', 'KPOP', 'WWE'
    ) then upper(btrim(cards.categorie))
    else btrim(cards.franchise)
  end,
  0
from public.cards cards
where case
    when upper(btrim(cards.categorie)) in (
      'ARTIST', 'DISNEY CHANNEL', 'FILM',
      'INTERNET PERSONALITY', 'KPOP', 'WWE'
    ) then upper(btrim(cards.categorie))
    else btrim(cards.franchise)
  end <> '';

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
        count(owned.card_id)::integer as owned
      from catalogue
      left join owned on owned.card_id = catalogue.id
      where safe_query = '' or catalogue.license ilike '%' || safe_query || '%'
      group by catalogue.license
    ),
    selected as (
      select progress.*, count(*) over()::integer as album_count
      from progress
      order by (progress.owned::numeric / nullif(progress.total, 0)) desc,
        progress.owned desc, progress.license
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'license', selected.license, 'total', selected.total,
        'owned', selected.owned,
        'percent', least(100, round(selected.owned::numeric * 100 / nullif(selected.total, 0)))
      ) order by (selected.owned::numeric / nullif(selected.total, 0)) desc,
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
      order by matching.nom, matching.id offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', selected.id, 'name', selected.nom, 'category', selected.categorie,
        'anime', selected.franchise, 'rarity', selected.rarete_base,
        'image', selected.image_url, 'owned', selected.owned
      ) order by selected.nom, selected.id), '[]'::jsonb),
      'total', coalesce(max(selected.card_count), 0)
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
        count(owned.card_id)::integer as owned
      from catalogue left join owned on owned.card_id = catalogue.id
      where safe_query = '' or catalogue.license ilike '%' || safe_query || '%'
      group by catalogue.license
    ),
    selected as (
      select progress.*, count(*) over()::integer as album_count from progress
      order by (progress.owned::numeric / nullif(progress.total, 0)) desc,
        progress.owned desc, progress.license
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'license', selected.license, 'total', selected.total,
        'owned', selected.owned,
        'percent', least(100, round(selected.owned::numeric * 100 / nullif(selected.total, 0)))
      ) order by (selected.owned::numeric / nullif(selected.total, 0)) desc,
        selected.owned desc, selected.license), '[]'::jsonb),
      'total', coalesce(max(selected.album_count), 0)
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
      order by matching.nom, matching.id offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', selected.id, 'name', selected.nom, 'category', selected.categorie,
        'anime', selected.franchise, 'rarity', selected.rarete_base,
        'image', selected.image_url, 'owned', selected.owned
      ) order by selected.nom, selected.id), '[]'::jsonb),
      'total', coalesce(max(selected.card_count), 0)
    ) from selected
  );
end;
$$;

commit;
