begin;

-- Primary display and binder memberships are independent. Preserve explicit links
-- when normalizing an empty primary; the admin syncs submitted memberships itself.
create or replace function public.normalize_card_franchise_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.franchise := nullif(btrim(new.franchise), '');
  new.franchise := case
    when upper(btrim(new.categorie)) = 'ANIME/MANGA'
      then public.normalize_anime_franchise(new.franchise)
    else public.normalize_card_franchise(new.franchise)
  end;
  return new;
end;
$$;

revoke all on function public.normalize_card_franchise_before_write()
  from public, anon, authenticated;

commit;
