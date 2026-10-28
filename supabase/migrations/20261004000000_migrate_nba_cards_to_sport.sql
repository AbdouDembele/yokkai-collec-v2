begin;

-- Preserve the affected card ids while both the main and secondary categories
-- are rewritten. This also handles legacy casing and surrounding whitespace.
create temporary table nba_cards_to_migrate on commit drop as
select id as card_id
from public.cards
where upper(btrim(categorie)) = 'NBA'
union
select card_id
from public.card_categories
where upper(btrim(categorie)) = 'NBA';

update public.cards as cards
set categorie = 'SPORT',
    franchise = 'NBA'
from nba_cards_to_migrate as nba_cards
where cards.id = nba_cards.card_id;

insert into public.card_categories (card_id, categorie)
select card_id, 'SPORT'
from nba_cards_to_migrate
on conflict (card_id, categorie) do nothing;

delete from public.card_categories
where upper(btrim(categorie)) = 'NBA';

commit;
