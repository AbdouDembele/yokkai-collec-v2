begin;

create index card_franchises_name_trgm_idx
  on public.card_franchises using gin (franchise extensions.gin_trgm_ops);

create function public.get_catalogue_cards_page(
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
            or c.franchise ilike '%' || terms.term || '%'
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
