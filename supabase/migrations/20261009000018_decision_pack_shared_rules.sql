begin;

-- One server-owned source for both draws and displayed Decision Pack rates.
create function public.decision_pack_drop_rates()
returns jsonb language sql immutable security invoker set search_path='' as $$
  select '[{"rarity":"SR","percent":96.5},{"rarity":"SSR","percent":3},{"rarity":"LR","percent":0.5}]'::jsonb
$$;
revoke all on function public.decision_pack_drop_rates() from public,anon,authenticated;

create or replace function public.discard_decision_pack_card(p_choice_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  target_pack uuid;
  discarded_rarity public.card_rarity;
  remaining integer;
  reward integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select choices.pack_id, choices.rarity into target_pack, discarded_rarity
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
  reward := public.card_destruction_value(discarded_rarity);
  perform public.credit_karas(auth.uid(), reward);
end;
$$;

create or replace function public.get_game_info()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  player_name text;
  balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select pseudo, karas_balance into player_name, balance
    from public.user_profiles where user_id = player_id;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'user', jsonb_build_object('id', player_id, 'name', player_name),
    'karasBalance', balance,
    'categories', (select coalesce(jsonb_agg(categorie order by categorie), '[]'::jsonb)
      from (select distinct categorie from public.cards) as categories),
    'rarities', jsonb_build_array('C', 'R', 'SR', 'SSR', 'LR'),
    'dropRates', '[{"rarity":"C","percent":72.4},{"rarity":"R","percent":20},{"rarity":"SR","percent":7},{"rarity":"SSR","percent":0.5},{"rarity":"LR","percent":0.1}]'::jsonb,
    'decisionDropRates', public.decision_pack_drop_rates(),
    'shinyRate', 0.1
  );
end;
$$;

create or replace function public.open_decision_pack()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  player_id uuid := auth.uid(); deadline timestamptz; server_now timestamptz;
  pending_id uuid; pack_id uuid; pool_sizes bigint[];
  rarities public.card_rarity[] := array['SR', 'SSR', 'LR']::public.card_rarity[];
  rates jsonb := public.decision_pack_drop_rates();
  rarity_index integer; selected_card public.cards%rowtype; shiny boolean; roll double precision;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select next_decision_pack_at into deadline from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  select id into pending_id from public.decision_packs where user_id=player_id and status='pending' for update;
  if pending_id is not null then return public.decision_pack_cards(pending_id); end if;
  server_now := clock_timestamp();
  if deadline > server_now then raise exception 'DECISION_PACK_NOT_READY' using errcode = 'P0001'; end if;
  select array[count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE' using errcode = 'P0001'; end if;
  insert into public.decision_packs(user_id,created_at) values(player_id,server_now) returning id into pack_id;
  for position in 1..5 loop
    roll:=random(); rarity_index:=case when roll<(rates->0->>'percent')::double precision/100 then 1 when roll<((rates->0->>'percent')::double precision+(rates->1->>'percent')::double precision)/100 then 2 else 3 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.001;
    insert into public.decision_pack_choices(pack_id,card_id,rarity,is_shiny,position)
      values(pack_id,selected_card.id,selected_card.rarete_base,shiny,position);
  end loop;
  update public.user_profiles set next_decision_pack_at=server_now+interval '1 day' where user_id=player_id;
  return public.decision_pack_cards(pack_id);
end;
$function$;

commit;
