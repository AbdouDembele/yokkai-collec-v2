begin;

-- Phase 1: one Regular Pack every 15 minutes, capped at five stored packs.
-- Backdate the first deadline by four intervals so every new account starts at 5/5.
alter table public.user_profiles
  alter column next_regular_pack_at set default (now() - interval '60 minutes');
comment on column public.user_profiles.next_regular_pack_at is
  'Availability of the earliest unconsumed Regular Pack. New profiles start with five packs; one regenerates every 15 minutes, capped at five.';

create or replace function public.get_regular_pack_status()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  deadline timestamptz;
  server_now timestamptz := statement_timestamp();
  available integer;
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select next_regular_pack_at into deadline from public.user_profiles where user_id = player_id;
  if not found then
    raise exception 'PROFILE_MISSING' using errcode = 'P0001';
  end if;
  available := least(5, greatest(0, 1 + floor(extract(epoch from (server_now - deadline)) / 900)))::integer;
  return jsonb_build_object(
    'available', available, 'maximum', 5,
    'nextPackAt', case when available = 5 then null
      else extract(epoch from (deadline + available * interval '15 minutes')) * 1000 end,
    'serverNow', extract(epoch from server_now) * 1000
  );
end;
$$;

create or replace function public.open_regular_pack()
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  deadline timestamptz;
  server_now timestamptz;
  pool_sizes bigint[];
  rarity_index integer;
  rarities public.card_rarity[] := array['C', 'R', 'SR', 'SSR']::public.card_rarity[];
  roll double precision;
  selected_card public.cards%rowtype;
  copy_id uuid;
  result jsonb := '[]'::jsonb;
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select next_regular_pack_at into deadline from public.user_profiles
    where user_id = player_id for update;
  if not found then
    raise exception 'PROFILE_MISSING' using errcode = 'P0001';
  end if;
  server_now := clock_timestamp();
  if deadline > server_now then
    raise exception 'PACK_NOT_READY' using errcode = 'P0001';
  end if;

  select array[
    count(*) filter (where rarete_base = 'C'), count(*) filter (where rarete_base = 'R'),
    count(*) filter (where rarete_base = 'SR'), count(*) filter (where rarete_base = 'SSR')
  ] into pool_sizes from public.cards where rarete_base <> 'LR';
  if 0 = any(pool_sizes) then
    raise exception 'CATALOGUE_INCOMPLETE' using errcode = 'P0001';
  end if;

  for position in 1..5 loop
    roll := random();
    rarity_index := case when roll < 0.60 then 1 when roll < 0.85 then 2
      when roll < 0.95 then 3 else 4 end;
    select * into selected_card from public.cards
      where rarete_base = rarities[rarity_index] order by id
      offset floor(random() * pool_sizes[rarity_index])::bigint limit 1;
    if not found then
      raise exception 'CATALOGUE_INCOMPLETE' using errcode = 'P0001';
    end if;
    insert into public.user_cards (user_id, card_id, date_obtention)
      values (player_id, selected_card.id, server_now) returning id into copy_id;
    result := result || jsonb_build_array(jsonb_build_object(
      'id', selected_card.id, 'name', selected_card.nom,
      'category', selected_card.categorie, 'rarity', selected_card.rarete_base,
      'image', selected_card.image_url, 'instanceId', copy_id, 'obtainedAt', server_now
    ));
  end loop;
  -- Clamp before consuming so elapsed time beyond the five-pack cap is discarded.
  update public.user_profiles
    set next_regular_pack_at = greatest(deadline, server_now - interval '60 minutes') + interval '15 minutes'
    where user_id = player_id;
  return result;
end;
$$;

revoke all on function public.get_regular_pack_status(), public.open_regular_pack()
  from public, anon, authenticated;
grant execute on function public.get_regular_pack_status(), public.open_regular_pack()
  to authenticated;

commit;
