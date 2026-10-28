begin;

create temporary table kdrama_cards_to_series
on commit drop
as
select id
from public.cards
where upper(btrim(categorie)) = 'KDRAMA';

do $$
declare
  target_count integer;
begin
  select count(*) into target_count from kdrama_cards_to_series;
  if target_count not in (0, 129) then
    raise exception 'KDRAMA_CARD_SET_CHANGED' using errcode = 'P0001';
  end if;
end;
$$;

update public.cards cards
set categorie = 'SERIE',
    franchise = 'KDRAMA'
from kdrama_cards_to_series targets
where cards.id = targets.id;

delete from public.card_categories categories
using kdrama_cards_to_series targets
where categories.card_id = targets.id;

insert into public.card_categories(card_id, categorie)
select id, 'SERIE'
from kdrama_cards_to_series;

delete from public.card_franchises franchises
using kdrama_cards_to_series targets
where franchises.card_id = targets.id;

insert into public.card_franchises(card_id, franchise, position)
select id, 'KDRAMA', 0
from kdrama_cards_to_series;

commit;
