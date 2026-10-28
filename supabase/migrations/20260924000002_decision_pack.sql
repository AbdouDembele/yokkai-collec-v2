begin;

alter table public.user_profiles
  add column next_decision_pack_at timestamptz not null default now();

create table public.decision_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'claimed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  kept_choice_id uuid
);

create unique index decision_packs_one_pending_per_user
  on public.decision_packs (user_id) where status = 'pending';

create table public.decision_pack_choices (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.decision_packs (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete restrict,
  rarity public.card_rarity not null check (rarity in ('SR', 'SSR', 'LR')),
  is_shiny boolean not null default false,
  is_discarded boolean not null default false,
  position smallint not null check (position between 1 and 5),
  unique (pack_id, position),
  unique (pack_id, id),
  check (not is_shiny or rarity in ('SSR', 'LR'))
);

alter table public.decision_packs
  add constraint decision_packs_kept_choice_fk
  foreign key (id, kept_choice_id)
  references public.decision_pack_choices (pack_id, id)
  deferrable initially deferred;

alter table public.decision_packs enable row level security;
alter table public.decision_pack_choices enable row level security;
revoke all on table public.decision_packs, public.decision_pack_choices
  from public, anon, authenticated;
grant all on table public.decision_packs, public.decision_pack_choices to service_role;

create function public.decision_pack_cards(p_pack_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cards.id, 'name', cards.nom, 'category', cards.categorie,
    'rarity', choices.rarity, 'image', cards.image_url,
    'instanceId', choices.id, 'obtainedAt', packs.created_at,
    'shiny', choices.is_shiny, 'isEvolved', false,
    'discarded', choices.is_discarded
  ) order by choices.rarity, choices.position), '[]'::jsonb)
  from public.decision_pack_choices as choices
  join public.decision_packs as packs on packs.id = choices.pack_id
  join public.cards as cards on cards.id = choices.card_id
  where choices.pack_id = p_pack_id;
$$;
revoke all on function public.decision_pack_cards(uuid) from public, anon, authenticated;

create function public.get_decision_pack_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  deadline timestamptz;
  server_now timestamptz := statement_timestamp();
  pending_id uuid;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select next_decision_pack_at into deadline from public.user_profiles where user_id = player_id;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  select id into pending_id from public.decision_packs
    where user_id = player_id and status = 'pending';
  return jsonb_build_object(
    'available', deadline <= server_now and pending_id is null,
    'nextPackAt', extract(epoch from deadline) * 1000,
    'serverNow', extract(epoch from server_now) * 1000,
    'pending', case when pending_id is null then '[]'::jsonb
      else public.decision_pack_cards(pending_id) end
  );
end;
$$;

create function public.open_decision_pack()
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  deadline timestamptz;
  server_now timestamptz;
  pending_id uuid;
  pack_id uuid;
  pool_sizes bigint[];
  rarities public.card_rarity[] := array['SR', 'SSR', 'LR']::public.card_rarity[];
  rarity_index integer;
  selected_card public.cards%rowtype;
  shiny boolean;
  roll double precision;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select next_decision_pack_at into deadline from public.user_profiles
    where user_id = player_id for update;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  select id into pending_id from public.decision_packs
    where user_id = player_id and status = 'pending' for update;
  if pending_id is not null then return public.decision_pack_cards(pending_id); end if;
  server_now := clock_timestamp();
  if deadline > server_now then raise exception 'DECISION_PACK_NOT_READY' using errcode = 'P0001'; end if;

  select array[
    count(*) filter (where rarete_base = 'SR'),
    count(*) filter (where rarete_base = 'SSR'),
    count(*) filter (where rarete_base = 'LR')
  ] into pool_sizes from public.cards;
  if 0 = any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE' using errcode = 'P0001'; end if;

  insert into public.decision_packs (user_id, created_at)
    values (player_id, server_now) returning id into pack_id;
  for position in 1..5 loop
    roll := random();
    rarity_index := case when roll < 0.94 then 1 when roll < 0.99 then 2 else 3 end;
    select * into selected_card from public.cards
      where rarete_base = rarities[rarity_index] order by id
      offset floor(random() * pool_sizes[rarity_index])::bigint limit 1;
    shiny := selected_card.rarete_base = 'LR' and random() < 0.05;
    insert into public.decision_pack_choices (pack_id, card_id, rarity, is_shiny, position)
      values (pack_id, selected_card.id, selected_card.rarete_base, shiny, position);
  end loop;
  update public.user_profiles set next_decision_pack_at = server_now + interval '1 day'
    where user_id = player_id;
  return public.decision_pack_cards(pack_id);
end;
$$;

create function public.keep_decision_pack_card(p_choice_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  choice record;
  copy_id uuid;
  kept_at timestamptz := clock_timestamp();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select choices.*, cards.nom, cards.categorie, cards.image_url into choice
    from public.decision_pack_choices as choices
    join public.decision_packs as packs on packs.id = choices.pack_id
    join public.cards as cards on cards.id = choices.card_id
    where choices.id = p_choice_id and packs.user_id = player_id and packs.status = 'pending'
    for update of packs, choices;
  if not found or choice.is_discarded then
    raise exception 'DECISION_CHOICE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  insert into public.user_cards (user_id, card_id, date_obtention, rarity, is_shiny, is_evolved)
    values (player_id, choice.card_id, kept_at, choice.rarity, choice.is_shiny, false)
    returning id into copy_id;
  update public.decision_packs set status = 'claimed', claimed_at = kept_at, kept_choice_id = choice.id
    where id = choice.pack_id;
  return jsonb_build_object(
    'id', choice.card_id, 'name', choice.nom, 'category', choice.categorie,
    'rarity', choice.rarity, 'image', choice.image_url, 'instanceId', copy_id,
    'obtainedAt', kept_at, 'shiny', choice.is_shiny, 'isEvolved', false
  );
end;
$$;

create function public.discard_regular_pack_card(p_card_instance_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  delete from public.user_cards where id = p_card_instance_id and user_id = auth.uid();
  if not found then raise exception 'CARD_NOT_OWNED' using errcode = 'P0001'; end if;
end;
$$;

create function public.discard_decision_pack_card(p_choice_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  target_pack uuid;
  remaining integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select choices.pack_id into target_pack
    from public.decision_pack_choices as choices
    join public.decision_packs as packs on packs.id = choices.pack_id
    where choices.id = p_choice_id and packs.user_id = auth.uid()
      and packs.status = 'pending' and not choices.is_discarded
    for update of packs, choices;
  if not found then raise exception 'DECISION_CHOICE_UNAVAILABLE' using errcode = 'P0001'; end if;
  select count(*) into remaining from public.decision_pack_choices
    where pack_id = target_pack and not is_discarded;
  if remaining <= 1 then raise exception 'DECISION_LAST_CHOICE' using errcode = 'P0001'; end if;
  update public.decision_pack_choices set is_discarded = true where id = p_choice_id;
end;
$$;

revoke all on function public.get_decision_pack_status(), public.open_decision_pack(),
  public.keep_decision_pack_card(uuid), public.discard_regular_pack_card(uuid),
  public.discard_decision_pack_card(uuid) from public, anon, authenticated;
grant execute on function public.get_decision_pack_status(), public.open_decision_pack(),
  public.keep_decision_pack_card(uuid), public.discard_regular_pack_card(uuid),
  public.discard_decision_pack_card(uuid) to authenticated;

commit;
