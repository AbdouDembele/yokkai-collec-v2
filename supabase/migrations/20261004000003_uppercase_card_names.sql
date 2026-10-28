begin;

update public.cards
set nom = upper(btrim(nom))
where btrim(nom) <> ''
  and nom <> upper(btrim(nom));

create or replace function public.normalize_card_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nom := upper(btrim(new.nom));
  return new;
end;
$$;

drop trigger if exists normalize_cards_name on public.cards;
create trigger normalize_cards_name
before insert or update of nom on public.cards
for each row execute function public.normalize_card_name();

commit;
