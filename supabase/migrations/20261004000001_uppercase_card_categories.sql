begin;

-- Add the normalized value before removing legacy variants so a card that
-- already has both spellings never violates the composite primary key.
insert into public.card_categories (card_id, categorie)
select card_id, upper(btrim(categorie))
from public.card_categories
where btrim(categorie) <> ''
  and categorie <> upper(btrim(categorie))
on conflict (card_id, categorie) do nothing;

delete from public.card_categories
where btrim(categorie) <> ''
  and categorie <> upper(btrim(categorie));

update public.cards
set categorie = upper(btrim(categorie))
where btrim(categorie) <> ''
  and categorie <> upper(btrim(categorie));

create or replace function public.normalize_card_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.categorie := upper(btrim(new.categorie));
  return new;
end;
$$;

drop trigger if exists normalize_cards_category on public.cards;
create trigger normalize_cards_category
before insert or update of categorie on public.cards
for each row execute function public.normalize_card_category();

drop trigger if exists normalize_card_categories_category on public.card_categories;
create trigger normalize_card_categories_category
before insert or update of categorie on public.card_categories
for each row execute function public.normalize_card_category();

commit;
