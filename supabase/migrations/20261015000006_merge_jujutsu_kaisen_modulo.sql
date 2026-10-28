begin;

-- Serialize catalogue/favourite writes only for this short transaction so an
-- import cannot change the audited set or recreate the old spelling mid-merge.
-- Ordinary reads remain available.
lock table public.cards, public.card_franchises, public.panini_album_favorites
  in share row exclusive mode;

-- Fail closed if the audited ten-card source changed before deployment.
-- Empty databases are allowed so the full migration history stays replayable.
do $$
declare
  source_count integer;
begin
  select count(*) into source_count from public.cards
  where categorie = 'ANIME/MANGA' and franchise = 'Jujutsu Kaisen Modulo';
  if source_count not in (0, 10) then
    raise exception 'JUJUTSU_MODULO_SOURCE_CHANGED: expected 10 cards, got %', source_count;
  end if;
end;
$$;

-- Existing category-aware triggers apply this rule to primary AND secondary
-- licences on future imports. Other categories and anime rules are unchanged.
create or replace function public.normalize_anime_franchise(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when lower(btrim(value)) = 'jujutsu kaisen modulo'
      then 'JUJUTSU KAISEN MODULO'
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

update public.cards
set franchise = 'JUJUTSU KAISEN MODULO'
where categorie = 'ANIME/MANGA' and franchise = 'Jujutsu Kaisen Modulo';

-- The existing case-insensitive unique index already prevents duplicate links
-- to these two spellings on the same card. Positions and other licences stay put.
update public.card_franchises links
set franchise = 'JUJUTSU KAISEN MODULO'
from public.cards cards
where cards.id = links.card_id and cards.categorie = 'ANIME/MANGA'
  and links.franchise = 'Jujutsu Kaisen Modulo';

insert into public.panini_album_favorites(user_id, license, created_at)
select user_id, 'JUJUTSU KAISEN MODULO', created_at
from public.panini_album_favorites
where license = 'Jujutsu Kaisen Modulo'
on conflict (user_id, license) do update
set created_at = least(public.panini_album_favorites.created_at, excluded.created_at);

-- Keep an old favourite only if a different category still uses that licence.
delete from public.panini_album_favorites
where license = 'Jujutsu Kaisen Modulo'
  and not exists (
    select 1 from public.card_franchises where franchise = 'Jujutsu Kaisen Modulo'
  );

commit;
