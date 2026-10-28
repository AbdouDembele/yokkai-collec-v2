begin;

alter table public.user_profiles
  add constraint user_profiles_pseudo_format_check check (
    char_length(btrim(pseudo)) between 3 and 30
    and btrim(pseudo) !~ '[/\\?#%<>[:cntrl:]]'
  );

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_pseudo text := btrim(new.raw_user_meta_data ->> 'pseudo');
begin
  if char_length(clean_pseudo) < 3 then
    raise exception 'PSEUDO_TOO_SHORT' using errcode = 'P0001';
  end if;
  if char_length(clean_pseudo) > 30 then
    raise exception 'PSEUDO_TOO_LONG' using errcode = 'P0001';
  end if;
  if clean_pseudo ~ '[/\\?#%<>[:cntrl:]]' then
    raise exception 'PSEUDO_INVALID_CHARACTERS' using errcode = 'P0001';
  end if;

  insert into public.user_profiles (user_id, pseudo)
  values (new.id, clean_pseudo);
  return new;
end;
$$;

commit;
