begin;

create or replace function public.normalize_card_franchise(value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  normalized text := btrim(value);
  previous text;
  skip_movie_normalization boolean := false;
begin
  -- Movie titles whose canonical series cannot be inferred safely with a
  -- generic suffix rule.
  normalized := case
    when normalized ~* '^one[[:space:]]+piece([[:space:]:-]|$)'
      then 'One Piece'
    when normalized ~* '^naruto([[:space:]:-]|$)'
      or normalized ~* '^road[[:space:]]+to[[:space:]]+ninja:[[:space:]]*naruto[[:space:]]+the[[:space:]]+movie'
      or normalized ~* '^boruto:[[:space:]]*naruto[[:space:]]+the[[:space:]]+movie'
      then 'Naruto'
    when normalized ~* '^pok[eé]mon([[:space:]:-]|$).*(movie|film)'
      then 'Pokémon'
    when normalized ~* '^sailor[[:space:]]+moon([[:space:]:-]|$).*(movie|film)'
      then 'Sailor Moon'
    when normalized ~* '^persona[[:space:]]+3[[:space:]]+the[[:space:]]+movie([[:space:][:punct:]]|$)'
      then 'Persona 3'
    when normalized ~* '^love[[:space:]]+hina([[:space:]:-]|$).*(movie|film)'
      then 'Love Hina'
    else normalized
  end;

  skip_movie_normalization := normalized ~* '(opening[[:space:]]+movie|short[[:space:]]+movies?|special[[:space:]]+movie|with[[:space:]]+a[[:space:]]+film[[:space:]]+director)';

  -- Remove a theatrical marker and everything after it. The marker must be a
  -- title suffix, which deliberately leaves names such as "Opening Movie",
  -- "Short Movies" and "with a film director" untouched.
  if not skip_movie_normalization then
    normalized := btrim(regexp_replace(
      normalized,
      '[[:space:]]*\([[:space:]]*(movie|film)[[:space:]]*\)[[:space:]]*$',
      '',
      'i'
    ));
    normalized := btrim(regexp_replace(
      normalized,
      '[[:space:]]*[-–—:]?[[:space:]]*(the[[:space:]]+movie|the[[:space:]]+motion[[:space:]]+picture|der[[:space:]]+film|movie|film)([[:space:]]+[#0-9]+)?([[:space:]]*[-–—:].*)?[[:space:]]*$',
      '',
      'i'
    ));
  end if;

  loop
    previous := normalized;
    normalized := btrim(regexp_replace(
      normalized,
      '[[:space:]]*[-–—:]?[[:space:]]*\(?(the[[:space:]]+final[[:space:]]+season|final[[:space:]]+season|([0-9]+(st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[[:space:]]+season|season(s)?[[:space:].-]*(final|[0-9]+|i|ii|iii|iv|v|vi|vii|viii|ix|x)([[:space:]]*&[[:space:]]*([0-9]+|i|ii|iii|iv|v|vi|vii|viii|ix|x))?|cour[[:space:].-]*([0-9]+|i|ii|iii|iv|v|vi|vii|viii|ix|x)|part[[:space:].-]*([0-9]+|one|two|three|four|i|ii|iii|iv|v|vi|vii|viii|ix|x))([[:space:][:punct:]].*)?$',
      '',
      'i'
    ));

    exit when normalized = previous or normalized = '';
  end loop;

  if normalized = '' then
    return btrim(value);
  end if;

  return normalized;
end;
$$;

comment on function public.normalize_card_franchise(text) is
  'Canonicalizes anime movie, season, cour and numbered-part franchise variants.';

update public.cards
set franchise = public.normalize_card_franchise(franchise)
where upper(categorie) = 'ANIME/MANGA'
  and franchise is distinct from public.normalize_card_franchise(franchise);

commit;
