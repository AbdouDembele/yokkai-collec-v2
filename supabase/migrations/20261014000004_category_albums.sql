begin;

create or replace function public.add_default_card_franchise_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_franchise text := case
    when upper(btrim(new.categorie)) in (
      'ARTIST', 'BRAINROT', 'DISNEY CHANNEL', 'FILM',
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

insert into public.panini_album_favorites(user_id, license, created_at)
select favorites.user_id, upper(btrim(cards.categorie)), min(favorites.created_at)
from public.panini_album_favorites favorites
join public.card_franchises links on links.franchise = favorites.license
join public.cards cards on cards.id = links.card_id
where upper(btrim(cards.categorie)) in ('KDRAMA', 'MEME', 'VOCALOID')
group by favorites.user_id, upper(btrim(cards.categorie))
on conflict (user_id, license) do nothing;

delete from public.panini_album_favorites favorites
where favorites.license not in ('KDRAMA', 'MEME', 'VOCALOID')
  and exists (
    select 1
    from public.card_franchises links
    join public.cards cards on cards.id = links.card_id
    where links.franchise = favorites.license
      and upper(btrim(cards.categorie)) in ('KDRAMA', 'MEME', 'VOCALOID')
  );

delete from public.card_franchises links
using public.cards cards
where cards.id = links.card_id
  and upper(btrim(cards.categorie)) in ('KDRAMA', 'MEME', 'VOCALOID');

insert into public.card_franchises(card_id, franchise, position)
select cards.id, upper(btrim(cards.categorie)), 0
from public.cards cards
where upper(btrim(cards.categorie)) in ('KDRAMA', 'MEME', 'VOCALOID');

revoke all on function public.add_default_card_franchise_after_insert()
  from public, anon, authenticated;

commit;
