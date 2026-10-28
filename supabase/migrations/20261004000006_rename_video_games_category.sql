begin;

insert into public.card_categories (card_id, categorie)
select card_id, 'VIDEO GAMES'
from public.card_categories
where upper(btrim(categorie)) = 'VIDEO GAME'
on conflict (card_id, categorie) do nothing;

delete from public.card_categories
where upper(btrim(categorie)) = 'VIDEO GAME';

update public.cards
set categorie = 'VIDEO GAMES'
where upper(btrim(categorie)) = 'VIDEO GAME';

create or replace function public.normalize_card_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.categorie := case upper(btrim(new.categorie))
    when 'ARTISTE' then 'ARTIST'
    when 'VIDEO GAME' then 'VIDEO GAMES'
    else upper(btrim(new.categorie))
  end;
  return new;
end;
$$;

commit;
