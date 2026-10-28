begin;

create or replace function public.normalize_anime_franchise(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when btrim(value) ~* '^black[[:space:]]+butler([[:space:]:-]|$)'
      then 'Black Butler'
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
  'Canonicalizes ANIME/MANGA franchises, including all Black Butler variants and standalone Roman-numeral sequel suffixes II-IV, while preserving Devil May Cry.';

insert into public.panini_album_favorites(user_id, license, created_at)
select favorites.user_id, 'Black Butler', min(favorites.created_at)
from public.panini_album_favorites favorites
where favorites.license ~* '^black[[:space:]]+butler([[:space:]:-]|$)'
group by favorites.user_id
on conflict (user_id, license) do nothing;

delete from public.panini_album_favorites
where license ~* '^black[[:space:]]+butler([[:space:]:-]|$)'
  and license <> 'Black Butler';

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

create or replace function public.add_default_card_franchise_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_franchise text := case
    when upper(btrim(new.categorie)) in (
      'ARTIST', 'BRAINROT', 'DISNEY CHANNEL', 'FILM',
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

insert into public.panini_album_favorites(user_id, license, created_at)
select favorites.user_id, 'BRAINROT', min(favorites.created_at)
from public.panini_album_favorites favorites
where exists (
  select 1
  from public.card_franchises links
  join public.cards cards on cards.id = links.card_id
  where upper(btrim(cards.categorie)) = 'BRAINROT'
    and links.franchise = favorites.license
)
group by favorites.user_id
on conflict (user_id, license) do nothing;

delete from public.panini_album_favorites favorites
where favorites.license <> 'BRAINROT'
  and exists (
    select 1
    from public.card_franchises links
    join public.cards cards on cards.id = links.card_id
    where upper(btrim(cards.categorie)) = 'BRAINROT'
      and links.franchise = favorites.license
  );

delete from public.card_franchises links
using public.cards cards
where cards.id = links.card_id
  and upper(btrim(cards.categorie)) = 'BRAINROT';

insert into public.card_franchises(card_id, franchise, position)
select cards.id, 'BRAINROT', 0
from public.cards cards
where upper(btrim(cards.categorie)) = 'BRAINROT';

revoke all on function public.add_default_card_franchise_after_insert()
  from public, anon, authenticated;
revoke all on function public.normalize_anime_franchise(text)
  from public, anon, authenticated;

commit;
