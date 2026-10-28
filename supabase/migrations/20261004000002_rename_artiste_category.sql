begin;

insert into public.card_categories (card_id, categorie)
select card_id, 'ARTIST'
from public.card_categories
where categorie = 'ARTISTE'
on conflict (card_id, categorie) do nothing;

delete from public.card_categories
where categorie = 'ARTISTE';

update public.cards
set categorie = 'ARTIST'
where categorie = 'ARTISTE';

create or replace function public.normalize_card_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.categorie := case upper(btrim(new.categorie))
    when 'ARTISTE' then 'ARTIST'
    else upper(btrim(new.categorie))
  end;
  return new;
end;
$$;

commit;
