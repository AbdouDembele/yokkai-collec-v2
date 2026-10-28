-- Make the daily decision pack more rewarding.
-- Each of its five independent choices is now SR 96.5% / SSR 3% / LR 0.5%.

begin;

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
    roll:=random(); rarity_index:=case when roll<.965 then 1 when roll<.995 then 2 else 3 end;
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
