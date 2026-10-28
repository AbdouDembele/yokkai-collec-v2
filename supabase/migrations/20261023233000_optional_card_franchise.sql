begin;

-- Existing cards and share snapshots are deliberately left unchanged.
alter table public.cards alter column franchise drop not null;
alter table public.cards alter column franchise drop default;
alter table public.card_shares alter column franchise drop not null;

-- Keep canonicalization, but store absence as SQL NULL on all write paths.
create or replace function public.normalize_card_franchise_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.franchise := nullif(btrim(new.franchise), '');
  new.franchise := case
    when upper(btrim(new.categorie)) = 'ANIME/MANGA'
      then public.normalize_anime_franchise(new.franchise)
    else public.normalize_card_franchise(new.franchise)
  end;
  if tg_op = 'UPDATE' and new.franchise is null then
    delete from public.card_franchises where card_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.add_default_card_franchise_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_franchise text := case
    when new.franchise is null then null
    when upper(btrim(new.categorie)) = 'ARTIST' then new.franchise
    when upper(btrim(new.categorie)) in (
      'BRAINROT', 'DISNEY CHANNEL', 'FILM',
      'INTERNET PERSONALITY', 'KDRAMA', 'KPOP', 'MEME',
      'VOCALOID', 'WWE'
    ) then upper(btrim(new.categorie))
    else new.franchise
  end;
begin
  if default_franchise is not null then
    insert into public.card_franchises(card_id, franchise, position)
    values (new.id, default_franchise, 0);
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_card_franchise_before_write()
  from public, anon, authenticated;
revoke all on function public.add_default_card_franchise_after_insert()
  from public, anon, authenticated;

-- NULL must behave as a non-match inside NOT/OR search predicates.
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
  safe_category text := btrim(coalesce(p_category, ''));
  safe_rarity text := upper(btrim(coalesce(p_rarity, '')));
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
      where (safe_category = '' or c.categorie = safe_category)
        and (safe_rarity = '' or c.rarete_base::text = safe_rarity)
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

revoke all on function public.get_catalogue_cards_page(text,text,text,integer,integer)
  from public;
grant execute on function public.get_catalogue_cards_page(text,text,text,integer,integer)
  to anon, authenticated;

commit;
