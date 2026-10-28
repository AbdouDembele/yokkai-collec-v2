begin;

create table public.achievements (
  id text primary key,
  titre text not null,
  description text not null,
  condition_type text not null,
  condition_value integer not null check (condition_value > 0),
  condition_categorie text,
  karas_reward integer not null check (karas_reward > 0),
  unique (condition_type, condition_value, condition_categorie)
);

create table public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievements(id) on delete cascade,
  completed_at timestamptz,
  claimed_at timestamptz,
  primary key (user_id, achievement_id),
  check (claimed_at is null or completed_at is not null)
);

-- Action counters cannot be reconstructed from the current collection: cards may
-- later be sold, traded or destroyed. They therefore live in a private ledger.
create table public.user_achievement_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  regular_packs_opened integer not null default 0 check (regular_packs_opened >= 0),
  decision_packs_completed integer not null default 0 check (decision_packs_completed >= 0),
  auctions_won integer not null default 0 check (auctions_won >= 0),
  trades_completed integer not null default 0 check (trades_completed >= 0),
  ssr_evolved_to_lr integer not null default 0 check (ssr_evolved_to_lr >= 0)
);

insert into public.achievements
  (id, titre, description, condition_type, condition_value, condition_categorie, karas_reward)
values
  ('premier-rituel', 'Premier rituel', 'Ouvrir son premier Regular Pack.', 'regular_packs_opened', 1, null, 10),
  ('habitude-installe', 'L''habitude s''installe', 'Ouvrir 10 Regular Packs.', 'regular_packs_opened', 10, null, 25),
  ('chasseur-yokkai', 'Chasseur de Yokkai', 'Ouvrir 50 Regular Packs.', 'regular_packs_opened', 50, null, 75),
  ('decision-decisive', 'Décision décisive', 'Finaliser son premier Decision Pack.', 'decision_packs_completed', 1, null, 20),
  ('collection-en-marche', 'Collection en marche', 'Réunir 25 cartes différentes du catalogue.', 'unique_cards_collected', 25, null, 30),
  ('legende-naissante', 'Légende naissante', 'Obtenir sa première carte LR.', 'first_lr_card', 1, null, 75),
  ('eclat-inattendu', 'Éclat inattendu', 'Obtenir sa première carte Shiny.', 'shiny_cards_collected', 1, null, 40),
  ('specialiste', 'Spécialiste', 'Compléter 50 % de n''importe quelle catégorie.', 'cards_collected_category_percent', 50, null, 100),
  ('adjuge', 'Adjugé !', 'Gagner sa première enchère.', 'auctions_won', 1, null, 40),
  ('marche-conclu', 'Marché conclu', 'Réaliser son premier échange accepté.', 'trades_completed', 1, null, 30),
  ('transcendance', 'Transcendance', 'Faire évoluer une première carte SSR en Shiny.', 'ssr_evolved_to_lr', 1, null, 100);

insert into public.user_achievement_stats
  (user_id, decision_packs_completed, auctions_won, trades_completed, ssr_evolved_to_lr)
select p.user_id,
  (select count(*) from public.decision_packs d where d.user_id=p.user_id and d.status='claimed'),
  (select count(*) from public.auctions a where a.buyer_id=p.user_id and a.status='sold'),
  (select count(*) from public.trade_offers t where t.status='accepted' and p.user_id in (t.from_user,t.to_user)),
  (select count(*) from public.user_cards uc where uc.user_id=p.user_id and uc.is_evolved)
from public.user_profiles p
on conflict (user_id) do nothing;

alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.user_achievement_stats enable row level security;
revoke all on table public.achievements, public.user_achievements, public.user_achievement_stats
  from public, anon, authenticated;
grant select on table public.achievements, public.user_achievements to authenticated;
grant all on table public.achievements, public.user_achievements, public.user_achievement_stats to service_role;
create policy achievements_read on public.achievements for select to authenticated using (true);
create policy user_achievements_read_own on public.user_achievements for select to authenticated
  using ((select auth.uid())=user_id);

create function public.ensure_achievement_stats(p_user_id uuid)
returns void language plpgsql volatile security definer set search_path=''
as $$
begin
  insert into public.user_achievement_stats(user_id) values(p_user_id) on conflict do nothing;
end;
$$;

create function public.achievement_progress(p_user_id uuid, p_condition_type text)
returns integer language plpgsql stable security definer set search_path=''
as $$
declare result integer;
begin
  result := case p_condition_type
    when 'regular_packs_opened' then (select regular_packs_opened from public.user_achievement_stats where user_id=p_user_id)
    when 'decision_packs_completed' then (select decision_packs_completed from public.user_achievement_stats where user_id=p_user_id)
    when 'auctions_won' then (select auctions_won from public.user_achievement_stats where user_id=p_user_id)
    when 'trades_completed' then (select trades_completed from public.user_achievement_stats where user_id=p_user_id)
    when 'ssr_evolved_to_lr' then (select ssr_evolved_to_lr from public.user_achievement_stats where user_id=p_user_id)
    when 'unique_cards_collected' then (select count(distinct card_id) from public.user_cards where user_id=p_user_id)
    when 'first_lr_card' then (select case when exists(
      select 1 from public.user_cards uc join public.cards c on c.id=uc.card_id
      where uc.user_id=p_user_id and c.rarete_base='LR'
    ) then 1 else 0 end)
    when 'shiny_cards_collected' then (select count(*) from public.user_cards where user_id=p_user_id and is_shiny)
    when 'cards_collected_category_percent' then (
      select coalesce(max(floor(100.0*owned/total)::integer),0) from (
        select c.categorie, count(distinct uc.card_id) as owned,
          (select count(*) from public.cards all_cards where all_cards.categorie=c.categorie) as total
        from public.cards c left join public.user_cards uc on uc.card_id=c.id and uc.user_id=p_user_id
        group by c.categorie
      ) category_progress where total>0
    )
    else 0
  end;
  return coalesce(result,0);
end;
$$;

create function public.complete_achievements(p_user_id uuid, p_condition_types text[])
returns void language plpgsql volatile security definer set search_path=''
as $$
begin
  insert into public.user_achievements(user_id,achievement_id,completed_at)
  select p_user_id,a.id,clock_timestamp() from public.achievements a
  where a.condition_type=any(p_condition_types)
    and public.achievement_progress(p_user_id,a.condition_type)>=a.condition_value
  on conflict (user_id,achievement_id) do update
    set completed_at=coalesce(public.user_achievements.completed_at,excluded.completed_at);
end;
$$;

create function public.on_profile_create_achievement_stats()
returns trigger language plpgsql security definer set search_path=''
as $$ begin perform public.ensure_achievement_stats(new.user_id); return new; end; $$;
create trigger user_profiles_create_achievement_stats after insert on public.user_profiles
  for each row execute function public.on_profile_create_achievement_stats();

create function public.on_card_acquired_achievements()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='UPDATE' and new.user_id=old.user_id then return new; end if;
  perform public.ensure_achievement_stats(new.user_id);
  if new.is_evolved then
    update public.user_achievement_stats set ssr_evolved_to_lr=ssr_evolved_to_lr+1 where user_id=new.user_id;
    perform public.complete_achievements(new.user_id,array['ssr_evolved_to_lr']);
  else
    perform public.complete_achievements(new.user_id,array[
      'unique_cards_collected','first_lr_card','shiny_cards_collected','cards_collected_category_percent'
    ]);
  end if;
  return new;
end;
$$;
create trigger user_cards_acquired_achievements after insert or update of user_id on public.user_cards
  for each row execute function public.on_card_acquired_achievements();

create function public.on_decision_pack_completed_achievement()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.status='pending' and new.status='claimed' then
    perform public.ensure_achievement_stats(new.user_id);
    update public.user_achievement_stats set decision_packs_completed=decision_packs_completed+1 where user_id=new.user_id;
    perform public.complete_achievements(new.user_id,array['decision_packs_completed']);
  end if;
  return new;
end;
$$;
create trigger decision_pack_completed_achievement after update of status on public.decision_packs
  for each row execute function public.on_decision_pack_completed_achievement();

create function public.on_auction_won_achievement()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.status='active' and new.status='sold' and new.buyer_id is not null then
    perform public.ensure_achievement_stats(new.buyer_id);
    update public.user_achievement_stats set auctions_won=auctions_won+1 where user_id=new.buyer_id;
    perform public.complete_achievements(new.buyer_id,array['auctions_won']);
  end if;
  return new;
end;
$$;
create trigger auction_won_achievement after update of status on public.auctions
  for each row execute function public.on_auction_won_achievement();

create function public.on_trade_completed_achievement()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.status='pending' and new.status='accepted' then
    perform public.ensure_achievement_stats(new.from_user);
    perform public.ensure_achievement_stats(new.to_user);
    update public.user_achievement_stats set trades_completed=trades_completed+1
      where user_id in (new.from_user,new.to_user);
    perform public.complete_achievements(new.from_user,array['trades_completed']);
    perform public.complete_achievements(new.to_user,array['trades_completed']);
  end if;
  return new;
end;
$$;
create trigger trade_completed_achievement after update of status on public.trade_offers
  for each row execute function public.on_trade_completed_achievement();

-- The pack counter is advanced inside the same transaction as the five cards.
create or replace function public.open_regular_pack()
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
  player_id uuid:=auth.uid(); deadline timestamptz; server_now timestamptz;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[]:=array['C','R','SR','SSR','LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; result jsonb:='[]'::jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select next_regular_pack_at into deadline from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;
  server_now:=clock_timestamp();
  if deadline>server_now then raise exception 'PACK_NOT_READY' using errcode='P0001'; end if;
  select array[count(*) filter(where rarete_base='C'),count(*) filter(where rarete_base='R'),
    count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE' using errcode='P0001'; end if;
  for position in 1..5 loop
    roll:=random();
    rarity_index:=case when roll<.59 then 1 when roll<.84 then 2 when roll<.94 then 3 when roll<.99 then 4 else 5 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.05;
    insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
      values(player_id,selected_card.id,server_now,selected_card.rarete_base,shiny,false,selected_card.rarete_base='LR')
      returning id into copy_id;
    result:=result||jsonb_build_array(jsonb_build_object('id',selected_card.id,'name',selected_card.nom,
      'category',selected_card.categorie,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
      'instanceId',copy_id,'obtainedAt',server_now,'shiny',shiny,'isEvolved',false,
      'isFirstOwner',selected_card.rarete_base='LR','folderId',null));
  end loop;
  update public.user_profiles set next_regular_pack_at=greatest(deadline,server_now-interval '60 minutes')+interval '15 minutes'
    where user_id=player_id;
  perform public.ensure_achievement_stats(player_id);
  update public.user_achievement_stats set regular_packs_opened=regular_packs_opened+1 where user_id=player_id;
  perform public.complete_achievements(player_id,array['regular_packs_opened']);
  return result;
end;
$$;

create function public.get_achievements()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare player_id uuid:=auth.uid(); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.user_profiles where user_id=player_id) then
    raise exception 'PROFILE_MISSING' using errcode='P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'title',a.titre,'description',a.description,'conditionType',a.condition_type,
    'conditionValue',a.condition_value,'conditionCategory',a.condition_categorie,'karasReward',a.karas_reward,
    'progressCurrent',case when ua.completed_at is not null then greatest(detail.current_value,detail.target_value) else detail.current_value end,
    'progressTarget',detail.target_value,'progressLabel',detail.progress_label,
    'completedAt',ua.completed_at,'claimedAt',ua.claimed_at
  ) order by ordering.position),'[]'::jsonb) into result
  from public.achievements a
  join (values
    ('premier-rituel',1),('habitude-installe',2),('chasseur-yokkai',3),('decision-decisive',4),
    ('collection-en-marche',5),('legende-naissante',6),('eclat-inattendu',7),('specialiste',8),
    ('adjuge',9),('marche-conclu',10),('transcendance',11)
  ) ordering(id,position) on ordering.id=a.id
  left join public.user_achievements ua on ua.achievement_id=a.id and ua.user_id=player_id
  cross join lateral (
    select
      case when a.condition_type='cards_collected_category_percent' then coalesce(best.owned,0)
        else public.achievement_progress(player_id,a.condition_type) end as current_value,
      case when a.condition_type='cards_collected_category_percent' then coalesce(best.required,a.condition_value)
        else a.condition_value end as target_value,
      case when a.condition_type='cards_collected_category_percent' then best.category else null end as progress_label
    from (select 1) seed
    left join lateral (
      select c.categorie as category,count(distinct uc.card_id)::integer as owned,
        ceil(count(distinct c.id)*a.condition_value/100.0)::integer as required
      from public.cards c left join public.user_cards uc on uc.card_id=c.id and uc.user_id=player_id
      where a.condition_type='cards_collected_category_percent'
        and (a.condition_categorie is null or c.categorie=a.condition_categorie)
      group by c.categorie
      order by count(distinct uc.card_id)::numeric/nullif(count(distinct c.id),0) desc,c.categorie limit 1
    ) best on true
  ) detail;
  return result;
end;
$$;

create function public.claim_achievement(p_achievement_id text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare player_id uuid:=auth.uid(); earned public.user_achievements%rowtype; reward integer; balance integer; claimed timestamptz:=clock_timestamp();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select * into earned from public.user_achievements
    where user_id=player_id and achievement_id=p_achievement_id for update;
  if not found or earned.completed_at is null then raise exception 'ACHIEVEMENT_LOCKED' using errcode='P0001'; end if;
  if earned.claimed_at is not null then raise exception 'ACHIEVEMENT_ALREADY_CLAIMED' using errcode='P0001'; end if;
  select karas_reward into reward from public.achievements where id=p_achievement_id;
  balance:=public.credit_karas(player_id,reward);
  update public.user_achievements set claimed_at=claimed
    where user_id=player_id and achievement_id=p_achievement_id;
  return jsonb_build_object('balance',balance,'claimedAt',claimed,'reward',reward);
end;
$$;

revoke all on function public.ensure_achievement_stats(uuid),public.achievement_progress(uuid,text),
  public.complete_achievements(uuid,text[]) from public,anon,authenticated;
revoke all on function public.get_achievements(),public.claim_achievement(text) from public,anon,authenticated;
grant execute on function public.get_achievements(),public.claim_achievement(text) to authenticated;

-- Complete collection-derived achievements for existing owners at migration time.
do $$ declare player record; begin
  for player in select user_id from public.user_profiles loop
    perform public.complete_achievements(player.user_id,array[
      'unique_cards_collected','first_lr_card','shiny_cards_collected','cards_collected_category_percent',
      'decision_packs_completed','auctions_won','trades_completed','ssr_evolved_to_lr'
    ]);
  end loop;
end $$;

commit;
