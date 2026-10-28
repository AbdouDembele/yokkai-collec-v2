begin;

create function public.normalize_anime_franchise(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when btrim(value) ~* '^devil[[:space:]]+may[[:space:]]+cry([[:space:]:-]|$)'
      then btrim(value)
    when btrim(value) ~* '^ace[[:space:]]+of[[:space:]]+the[[:space:]]+diamond[[:space:]]+act[[:space:]]+(ii|iii|iv)[[:space:]]*$'
      then 'Ace of the Diamond'
    when btrim(regexp_replace(
      public.normalize_card_franchise(value),
      '([[:space:]]+|[[:space:]]*[:-][[:space:]]*)(II|III|IV)[[:space:]]*$',
      '',
      ''
    )) = '' then public.normalize_card_franchise(value)
    else btrim(regexp_replace(
      public.normalize_card_franchise(value),
      '([[:space:]]+|[[:space:]]*[:-][[:space:]]*)(II|III|IV)[[:space:]]*$',
      '',
      ''
    ))
  end
$$;

comment on function public.normalize_anime_franchise(text) is
  'Canonicalizes ANIME/MANGA franchises, including standalone Roman-numeral sequel suffixes II-IV, while preserving Devil May Cry.';

create or replace function public.normalize_card_franchise_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.franchise := case
    when upper(btrim(new.categorie)) = 'ANIME/MANGA'
      then public.normalize_anime_franchise(new.franchise)
    else public.normalize_card_franchise(new.franchise)
  end;
  return new;
end;
$$;

drop trigger cards_normalize_franchise_before_write on public.cards;
create trigger cards_normalize_franchise_before_write
before insert or update of franchise, categorie on public.cards
for each row execute function public.normalize_card_franchise_before_write();

create or replace function public.normalize_card_franchise_link_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  card_category text;
begin
  select cards.categorie into card_category
  from public.cards cards
  where cards.id = new.card_id;

  new.franchise := case
    when upper(btrim(card_category)) = 'ANIME/MANGA'
      then public.normalize_anime_franchise(new.franchise)
    else public.normalize_card_franchise(new.franchise)
  end;
  return new;
end;
$$;

update public.cards
set franchise = public.normalize_anime_franchise(franchise)
where upper(btrim(categorie)) = 'ANIME/MANGA'
  and franchise is distinct from public.normalize_anime_franchise(franchise);

delete from public.card_franchises duplicate
using public.card_franchises retained, public.cards cards
where duplicate.card_id = retained.card_id
  and cards.id = duplicate.card_id
  and upper(btrim(cards.categorie)) = 'ANIME/MANGA'
  and duplicate.position > retained.position
  and lower(public.normalize_anime_franchise(duplicate.franchise)) =
    lower(public.normalize_anime_franchise(retained.franchise));

update public.card_franchises links
set franchise = public.normalize_anime_franchise(links.franchise)
from public.cards cards
where cards.id = links.card_id
  and upper(btrim(cards.categorie)) = 'ANIME/MANGA'
  and links.franchise is distinct from public.normalize_anime_franchise(links.franchise);

revoke all on function public.normalize_anime_franchise(text)
  from public, anon, authenticated;

commit;
