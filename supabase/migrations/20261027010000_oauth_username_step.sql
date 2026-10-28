begin;

-- OAuth sign-ups (Google, Discord) carry no username: GoTrue only stores the
-- provider identity in raw_user_meta_data. The strict email-signup trigger would
-- reject them, so they get a temporary username and must choose a real one.
-- Kept out of user_profiles, whose columns are all exported: this marker only
-- lives until the username step and is classified as excluded.
create table public.oauth_pseudo_pending (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.oauth_pseudo_pending enable row level security;
revoke all on public.oauth_pseudo_pending from public, anon, authenticated;
grant all on public.oauth_pseudo_pending to service_role;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_pseudo text := btrim(new.raw_user_meta_data ->> 'pseudo');
  submitted_code text := lower(btrim(new.raw_user_meta_data ->> 'referral_code'));
  -- to_jsonb keeps the trigger valid on test schemas without this GoTrue column.
  signup_provider text := to_jsonb(new) -> 'raw_app_meta_data' ->> 'provider';
begin
  if signup_provider in ('google', 'discord') then
    loop
      begin
        insert into public.user_profiles (user_id, pseudo)
        values (new.id, 'player-' || substr(md5(random()::text), 1, 16));
        exit;
      exception when unique_violation then
        -- A player already chose this exact name: draw another one.
      end;
    end loop;
    insert into public.oauth_pseudo_pending (user_id) values (new.id);
    return new;
  end if;

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

  if submitted_code ~ '^[a-f0-9]{12}$' then
    insert into public.referrals (code_id, referrer_id, referred_id)
      select codes.id, codes.user_id, new.id
      from public.referral_codes codes
      where codes.code = submitted_code and codes.user_id <> new.id
      on conflict (referred_id) do nothing;
  end if;

  if new.email_confirmed_at is not null then
    perform public.complete_referral_after_verification(
      new.id,
      new.email_confirmed_at
    );
  end if;
  return new;
end;
$$;
revoke all on function public.handle_new_user_profile()
  from public, anon, authenticated;

create function public.is_pseudo_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.oauth_pseudo_pending where user_id = auth.uid()
  );
$$;
revoke all on function public.is_pseudo_required() from public, anon;
grant execute on function public.is_pseudo_required() to authenticated;

-- One-time username step of an OAuth account. Same rules as the signup trigger;
-- the referral code survives the provider round trip in an httpOnly cookie.
create function public.choose_pseudo(p_pseudo text, p_referral_code text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player uuid := auth.uid();
  clean_pseudo text := btrim(p_pseudo);
  submitted_code text := lower(btrim(p_referral_code));
  confirmed_at timestamptz;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if exists (
    select 1 from public.account_deletion_log where user_id = player
  ) then raise exception 'ACCOUNT_DELETING'; end if;
  if clean_pseudo is null or char_length(clean_pseudo) < 3 then
    raise exception 'PSEUDO_TOO_SHORT' using errcode = 'P0001';
  end if;
  if char_length(clean_pseudo) > 30 then
    raise exception 'PSEUDO_TOO_LONG' using errcode = 'P0001';
  end if;
  if clean_pseudo ~ '[/\\?#%<>[:cntrl:]]' then
    raise exception 'PSEUDO_INVALID_CHARACTERS' using errcode = 'P0001';
  end if;

  delete from public.oauth_pseudo_pending where user_id = player;
  if not found then raise exception 'PSEUDO_ALREADY_CHOSEN'; end if;
  begin
    update public.user_profiles set pseudo = clean_pseudo where user_id = player;
  exception when unique_violation then
    -- Also rolls back the deletion above: the step stays pending.
    raise exception 'PSEUDO_TAKEN' using errcode = 'P0001';
  end;

  if submitted_code ~ '^[a-f0-9]{12}$' then
    insert into public.referrals (code_id, referrer_id, referred_id)
      select codes.id, codes.user_id, player
      from public.referral_codes codes
      where codes.code = submitted_code and codes.user_id <> player
      on conflict (referred_id) do nothing;
  end if;

  select email_confirmed_at into confirmed_at from auth.users where id = player;
  if confirmed_at is not null then
    perform public.complete_referral_after_verification(player, confirmed_at);
  end if;
end;
$$;
revoke all on function public.choose_pseudo(text, text) from public, anon;
grant execute on function public.choose_pseudo(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
