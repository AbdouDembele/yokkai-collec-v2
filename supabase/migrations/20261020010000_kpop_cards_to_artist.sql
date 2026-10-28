begin;

create temporary table kpop_cards_to_artist
on commit drop
as
select id
from public.cards
where upper(btrim(categorie)) = 'KPOP';

do $$
declare
  target_count integer;
begin
  select count(*) into target_count from kpop_cards_to_artist;
  if target_count not in (0, 127) then
    raise exception 'KPOP_CARD_SET_CHANGED' using errcode = 'P0001';
  end if;
end;
$$;

update public.cards cards
set categorie = 'ARTIST',
    franchise = 'KPOP'
from kpop_cards_to_artist targets
where cards.id = targets.id;

delete from public.card_categories categories
using kpop_cards_to_artist targets
where categories.card_id = targets.id;

insert into public.card_categories(card_id, categorie)
select id, 'ARTIST'
from kpop_cards_to_artist;

delete from public.card_franchises franchises
using kpop_cards_to_artist targets
where franchises.card_id = targets.id;

insert into public.card_franchises(card_id, franchise, position)
select id, 'KPOP', 0
from kpop_cards_to_artist;

create or replace function public.add_default_card_franchise_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_franchise text := case
    when upper(btrim(new.categorie)) = 'ARTIST'
      then coalesce(nullif(btrim(new.franchise), ''), 'ARTIST')
    when upper(btrim(new.categorie)) in (
      'BRAINROT', 'DISNEY CHANNEL', 'FILM',
      'INTERNET PERSONALITY', 'KDRAMA', 'KPOP', 'MEME',
      'VOCALOID', 'WWE'
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

revoke all on function public.add_default_card_franchise_after_insert()
  from public, anon, authenticated;

commit;
