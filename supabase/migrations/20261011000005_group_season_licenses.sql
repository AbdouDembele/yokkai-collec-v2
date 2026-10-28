begin;

create function public.normalize_card_franchise(value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  normalized text := btrim(value);
  previous text;
begin
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
  'Removes explicit season, cour and numbered-part suffixes from card franchises.';

create function public.normalize_card_franchise_before_write()
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

create trigger cards_normalize_franchise_before_write
before insert or update of franchise on public.cards
for each row execute function public.normalize_card_franchise_before_write();

update public.cards
set franchise = public.normalize_card_franchise(franchise)
where franchise is distinct from public.normalize_card_franchise(franchise);

revoke all on function public.normalize_card_franchise(text),
  public.normalize_card_franchise_before_write()
  from public, anon, authenticated;

commit;
