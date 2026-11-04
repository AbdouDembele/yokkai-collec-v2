begin;

-- Prevent reward/open transactions from crossing the legacy-balance snapshot
-- before the grant and opening triggers are installed.
lock table public.referrals, public.user_profiles in share row exclusive mode;

-- Referral rewards granted after this migration are tracked individually.
-- Existing bonus balances and previously opened packs cannot be attributed
-- reliably, so future openings from those balances are explicitly marked legacy.
create table public.referral_pack_reward_lots (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null,
  referrer_id uuid not null,
  referred_id uuid not null,
  beneficiary_id uuid not null,
  beneficiary_role text not null check (beneficiary_role in ('referrer','referred')),
  granted_packs integer not null check (granted_packs > 0),
  remaining_packs integer not null check (remaining_packs >= 0),
  removed_packs integer not null default 0 check (removed_packs >= 0),
  granted_at timestamptz not null default clock_timestamp(),
  unique (referral_id, beneficiary_role),
  check (remaining_packs + removed_packs <= granted_packs)
);
create index referral_pack_reward_lots_beneficiary_idx
  on public.referral_pack_reward_lots (beneficiary_id, granted_at, id)
  where remaining_packs > 0;
alter table public.referral_pack_reward_lots enable row level security;
revoke all on public.referral_pack_reward_lots from public, anon, authenticated, service_role;
grant all on public.referral_pack_reward_lots to service_role;

-- Snapshot already-available bonus balances as unattributed legacy inventory.
-- Do not pretend these pre-migration packs came from a particular referral.
create table public.legacy_regular_pack_bonus_balances (
  user_id uuid primary key,
  remaining_packs integer not null check (remaining_packs >= 0),
  captured_at timestamptz not null default clock_timestamp()
);
alter table public.legacy_regular_pack_bonus_balances enable row level security;
revoke all on public.legacy_regular_pack_bonus_balances from public, anon, authenticated, service_role;
grant all on public.legacy_regular_pack_bonus_balances to service_role;
insert into public.legacy_regular_pack_bonus_balances(user_id,remaining_packs)
  select user_id,bonus_regular_packs from public.user_profiles where bonus_regular_packs>0;

create table public.regular_pack_openings (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null,
  source text not null check (source in ('referral_reward','legacy_bonus','timed')),
  referral_reward_lot_id uuid,
  referral_id uuid,
  source_referrer_id uuid,
  source_referred_id uuid,
  beneficiary_role text check (beneficiary_role is null or beneficiary_role in ('referrer','referred')),
  opened_at timestamptz not null default clock_timestamp(),
  check ((source = 'referral_reward') = (referral_reward_lot_id is not null)),
  check (source <> 'referral_reward' or (referral_id is not null and beneficiary_role is not null))
);
create index regular_pack_openings_user_idx
  on public.regular_pack_openings (opened_by, opened_at desc);
create index regular_pack_openings_referral_idx
  on public.regular_pack_openings (referral_id, opened_at)
  where referral_id is not null;
alter table public.regular_pack_openings enable row level security;
revoke all on public.regular_pack_openings from public, anon, authenticated, service_role;
grant all on public.regular_pack_openings to service_role;

create table public.regular_pack_opening_cards (
  card_instance_id uuid primary key,
  pack_opening_id uuid not null,
  card_id uuid not null,
  original_owner_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index regular_pack_opening_cards_pack_idx
  on public.regular_pack_opening_cards (pack_opening_id, card_instance_id);
create index regular_pack_opening_cards_catalogue_idx
  on public.regular_pack_opening_cards (card_id, recorded_at desc);
alter table public.regular_pack_opening_cards enable row level security;
revoke all on public.regular_pack_opening_cards from public, anon, authenticated, service_role;
grant all on public.regular_pack_opening_cards to service_role;

-- No foreign keys to accounts or cards: this evidence survives account deletion
-- and card recovery. A trade's Karas are available through trade_offer_id;
-- sale_karas is exact only for a completed auction sale.
create table public.regular_pack_card_transfers (
  id bigint generated always as identity primary key,
  card_instance_id uuid not null,
  from_user_id uuid,
  to_user_id uuid,
  transfer_type text not null check (transfer_type in ('trade','auction_sale','other','removed')),
  trade_offer_id uuid,
  auction_id uuid,
  sale_karas integer check (sale_karas is null or sale_karas >= 0),
  occurred_at timestamptz not null default clock_timestamp(),
  check (transfer_type <> 'trade' or trade_offer_id is not null),
  check (transfer_type <> 'auction_sale' or (auction_id is not null and sale_karas is not null))
);
create index regular_pack_card_transfers_card_idx
  on public.regular_pack_card_transfers (card_instance_id, occurred_at, id);
create index regular_pack_card_transfers_accounts_idx
  on public.regular_pack_card_transfers (from_user_id, to_user_id, occurred_at desc);
alter table public.regular_pack_card_transfers enable row level security;
revoke all on public.regular_pack_card_transfers from public, anon, authenticated, service_role;
grant all on public.regular_pack_card_transfers to service_role;
revoke all on sequence public.regular_pack_card_transfers_id_seq from public, anon, authenticated, service_role;

-- Capture grants at the authoritative transition that marks a referral rewarded.
-- Trigger execution inherits the trusted reward function's privileges.
create function public.capture_referral_pack_reward_lots()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.rewarded_at is not null or new.rewarded_at is null then return new; end if;
  insert into public.referral_pack_reward_lots
    (referral_id,referrer_id,referred_id,beneficiary_id,beneficiary_role,granted_packs,remaining_packs,granted_at)
  values
    (new.id,new.referrer_id,new.referred_id,new.referrer_id,'referrer',new.reward_packs,new.reward_packs,new.rewarded_at),
    (new.id,new.referrer_id,new.referred_id,new.referred_id,'referred',new.reward_packs,new.reward_packs,new.rewarded_at)
  on conflict (referral_id,beneficiary_role) do nothing;
  return new;
end;
$$;
revoke all on function public.capture_referral_pack_reward_lots() from public, anon, authenticated, service_role;
create trigger referrals_capture_pack_reward_lots
after update of rewarded_at on public.referrals
for each row execute function public.capture_referral_pack_reward_lots();

-- The existing automatic network enforcement records exact pack clawbacks by
-- referral. Keep the provenance lots in sync with that same immutable decision.
create function public.apply_referral_pack_lot_clawback()
returns trigger language plpgsql set search_path = '' as $$
declare delta integer;
begin
  delta := greatest(0,new.referral_packs_removed-old.referral_packs_removed);
  if delta = 0 then return new; end if;
  update public.referral_pack_reward_lots
    set remaining_packs = remaining_packs-least(remaining_packs,delta),
        removed_packs = removed_packs+least(remaining_packs,delta)
    where referral_id=new.referral_id and beneficiary_role='referrer';
  return new;
end;
$$;
revoke all on function public.apply_referral_pack_lot_clawback() from public, anon, authenticated, service_role;
create trigger anticheat_referral_pack_lot_clawback
after update of referral_packs_removed on public.anticheat_referral_enforcements
for each row execute function public.apply_referral_pack_lot_clawback();

-- Ownership movement remains attached to the original instance ID through
-- accepted trades and auction settlement, even if the original owner is deleted.
create function public.record_referral_pack_card_transfer()
returns trigger language plpgsql set search_path = '' as $$
declare has_pending_trade boolean; matched_auction_id uuid; matched_sale_karas integer;
begin
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    select a.id,a.current_price into matched_auction_id,matched_sale_karas
      from public.auctions a
      where a.card_instance_id=old.id and a.status='sold'
        and a.seller_id=old.user_id and a.buyer_id=new.user_id
      order by a.created_at desc limit 1;
    if matched_auction_id is not null then
      insert into public.regular_pack_card_transfers
        (card_instance_id,from_user_id,to_user_id,transfer_type,auction_id,sale_karas)
      values (old.id,old.user_id,new.user_id,'auction_sale',matched_auction_id,matched_sale_karas);
      return new;
    end if;

    select exists(
      select 1 from public.trade_offers t
      where t.status='pending' and (
        (t.from_user=old.user_id and t.to_user=new.user_id and old.id=any(t.offered_card_ids))
        or (t.to_user=old.user_id and t.from_user=new.user_id and old.id=any(t.requested_card_ids))
      )
    ) into has_pending_trade;
    -- The authoritative offer trigger writes the exact trade ID after the
    -- accepted status transition; do not guess between overlapping offers.
    if has_pending_trade then return new; end if;
    insert into public.regular_pack_card_transfers
      (card_instance_id,from_user_id,to_user_id,transfer_type)
    values (old.id,old.user_id,new.user_id,'other');
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.regular_pack_card_transfers
      (card_instance_id,from_user_id,transfer_type)
    values (old.id,old.user_id,'removed');
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.record_referral_pack_card_transfer() from public, anon, authenticated, service_role;
create trigger user_cards_record_referral_pack_transfer
after update of user_id or delete on public.user_cards
for each row execute function public.record_referral_pack_card_transfer();

create function public.record_referral_pack_trade()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'pending' or new.status <> 'accepted' then return new; end if;
  insert into public.regular_pack_card_transfers
    (card_instance_id,from_user_id,to_user_id,transfer_type,trade_offer_id)
  select provenance.card_instance_id,new.from_user,new.to_user,'trade',new.id
    from unnest(new.offered_card_ids) as offered(card_instance_id)
    join public.regular_pack_opening_cards provenance using (card_instance_id);
  insert into public.regular_pack_card_transfers
    (card_instance_id,from_user_id,to_user_id,transfer_type,trade_offer_id)
  select provenance.card_instance_id,new.to_user,new.from_user,'trade',new.id
    from unnest(new.requested_card_ids) as requested(card_instance_id)
    join public.regular_pack_opening_cards provenance using (card_instance_id);
  return new;
end;
$$;
revoke all on function public.record_referral_pack_trade() from public, anon, authenticated, service_role;
create trigger trade_offers_record_referral_pack_transfer
after update of status on public.trade_offers
for each row execute function public.record_referral_pack_trade();

-- Preserve the live draw rules and result shape. Bonus packs still open first;
-- tracked referral rewards are consumed FIFO, while pre-migration balance is
-- explicitly labeled legacy_bonus instead of being assigned a guessed source.
create or replace function public.open_regular_pack()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid:=auth.uid(); deadline timestamptz; server_now timestamptz;
  step integer; bonus integer; reserve_maximum integer;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[]:=array['C','R','SR','SSR','LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; copy_ids uuid[]:='{}'; card_ids uuid[]:='{}'; shinies boolean[]:='{}';
  result jsonb:='[]'::jsonb; boosted boolean; source_name text;
  reward_lot public.referral_pack_reward_lots%rowtype; legacy_bonus integer:=0;
  opening_id uuid:=gen_random_uuid();
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player_id);
  select next_regular_pack_at,regular_pack_interval_seconds,bonus_regular_packs
    into deadline,step,bonus
    from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  reserve_maximum:=case when public.billing_has_game_pro(player_id) then 10 else 5 end;
  server_now:=clock_timestamp();
  if bonus=0 and deadline>server_now then raise exception 'PACK_NOT_READY'; end if;

  if bonus>0 then
    select remaining_packs into legacy_bonus from public.legacy_regular_pack_bonus_balances
      where user_id=player_id for update;
    if coalesce(legacy_bonus,0)>0 then
      update public.legacy_regular_pack_bonus_balances
        set remaining_packs=remaining_packs-1 where user_id=player_id;
      source_name:='legacy_bonus';
    else
      select * into reward_lot from public.referral_pack_reward_lots
        where beneficiary_id=player_id and remaining_packs>0
        order by granted_at,id limit 1 for update;
      if found then
        update public.referral_pack_reward_lots
          set remaining_packs=remaining_packs-1 where id=reward_lot.id;
        source_name:='referral_reward';
      else
        source_name:='legacy_bonus';
      end if;
    end if;
  else
    source_name:='timed';
  end if;

  select array[count(*) filter(where rarete_base='C'),count(*) filter(where rarete_base='R'),
    count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE'; end if;
  boosted:=coalesce((select regular_packs_opened from public.user_achievement_stats where user_id=player_id),0)<10;
  for position in 1..5 loop
    roll:=random();
    if not boosted then
      rarity_index:=case when roll<.694 then 1 when roll<.894 then 2 when roll<.994 then 3 when roll<.999 then 4 else 5 end;
    else
      rarity_index:=case when roll<.639 then 1 when roll<.839 then 2 when roll<.989 then 3 when roll<.999 then 4 else 5 end;
    end if;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.01;
    copy_id:=gen_random_uuid();
    copy_ids:=array_append(copy_ids,copy_id); card_ids:=array_append(card_ids,selected_card.id); shinies:=array_append(shinies,shiny);
    result:=result||jsonb_build_array(jsonb_build_object(
      'id',selected_card.id,'name',selected_card.nom,'category',selected_card.categorie,
      'liveFranchise',true,'anime',selected_card.franchise,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
      'catalogueImage',selected_card.image_url,'customImageUrl',null,
      'instanceId',copy_id,'obtainedAt',server_now,'shiny',shiny,'isEvolved',false,
      'isFirstOwner',selected_card.rarete_base='LR','folderId',null));
  end loop;
  insert into public.user_cards(id,user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    select drawn.id,player_id,drawn.card_id,server_now,c.rarete_base,drawn.shiny,false,c.rarete_base='LR'
    from unnest(copy_ids,card_ids,shinies) as drawn(id,card_id,shiny) join public.cards c on c.id=drawn.card_id;
  insert into public.regular_pack_openings
    (id,opened_by,source,referral_reward_lot_id,referral_id,source_referrer_id,source_referred_id,beneficiary_role,opened_at)
  values (opening_id,player_id,source_name,
    case when source_name='referral_reward' then reward_lot.id end,
    case when source_name='referral_reward' then reward_lot.referral_id end,
    case when source_name='referral_reward' then reward_lot.referrer_id end,
    case when source_name='referral_reward' then reward_lot.referred_id end,
    case when source_name='referral_reward' then reward_lot.beneficiary_role end,server_now);
  insert into public.regular_pack_opening_cards
    (card_instance_id,pack_opening_id,card_id,original_owner_id,recorded_at)
  select drawn.id,opening_id,drawn.card_id,player_id,server_now
    from unnest(copy_ids,card_ids) as drawn(id,card_id);
  update public.user_profiles set
    bonus_regular_packs=case when bonus>0 then bonus-1 else 0 end,
    next_regular_pack_at=case when bonus>0 then deadline
      else greatest(deadline,server_now-make_interval(secs=>(reserve_maximum-1)*step))+make_interval(secs=>step) end
    where user_id=player_id;
  perform public.ensure_achievement_stats(player_id);
  update public.user_achievement_stats set regular_packs_opened=regular_packs_opened+1 where user_id=player_id;
  perform public.complete_achievements(player_id,array['regular_packs_opened']);
  return result;
end;
$$;
revoke all on function public.open_regular_pack() from public, anon, service_role;
grant execute on function public.open_regular_pack() to authenticated;

-- Admin-only, bounded provenance lookup for the cards shown in the security
-- event journal. It deliberately returns only referral-funded pack cards.
create function public.admin_get_referral_pack_provenance(p_card_instance_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if coalesce(cardinality(p_card_instance_ids),0)>1000 then raise exception 'TOO_MANY_CARDS'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'cardInstanceId', provenance.card_instance_id,
    'cardName', c.nom,
    'rarity', coalesce(uc.rarity::text,c.rarete_base::text),
    'franchise', c.franchise,
    'beneficiaryRole', opening.beneficiary_role,
    'openedAt', opening.opened_at,
    'openedBy', coalesce(opener.pseudo,case when opener_deleted.identity_expires_at>statement_timestamp() then opener_deleted.pseudo end),
    'referrer', coalesce(referrer.pseudo,case when referrer_deleted.identity_expires_at>statement_timestamp() then referrer_deleted.pseudo end),
    'referred', coalesce(referred.pseudo,case when referred_deleted.identity_expires_at>statement_timestamp() then referred_deleted.pseudo end),
    'rewardGrantedAt', lot.granted_at,
    'transfers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', transfer.transfer_type,
        'occurredAt', transfer.occurred_at,
        'from', coalesce(sender.pseudo,case when sender_deleted.identity_expires_at>statement_timestamp() then sender_deleted.pseudo end),
        'to', coalesce(recipient.pseudo,case when recipient_deleted.identity_expires_at>statement_timestamp() then recipient_deleted.pseudo end),
        'karas', case
          when transfer.transfer_type='auction_sale' then transfer.sale_karas
          when transfer.transfer_type='trade' and transfer.trade_offer_id is not null then
            (select case
              when transfer.from_user_id=trade.from_user then trade.offered_karas
              else trade.requested_karas
            end from public.trade_offers trade where trade.id=transfer.trade_offer_id)
          else null
        end
      ) order by transfer.occurred_at,transfer.id)
      from public.regular_pack_card_transfers transfer
      left join public.user_profiles sender on sender.user_id=transfer.from_user_id
      left join public.user_profiles recipient on recipient.user_id=transfer.to_user_id
      left join public.anticheat_deleted_accounts sender_deleted on sender_deleted.user_id=transfer.from_user_id
      left join public.anticheat_deleted_accounts recipient_deleted on recipient_deleted.user_id=transfer.to_user_id
      where transfer.card_instance_id=provenance.card_instance_id
    ),'[]'::jsonb)
  ) order by opening.opened_at,provenance.card_instance_id),'[]'::jsonb)
  into result
  from (
    select distinct unnest(p_card_instance_ids) as card_instance_id
  ) requested
  join public.regular_pack_opening_cards provenance using (card_instance_id)
  join public.regular_pack_openings opening on opening.id=provenance.pack_opening_id
  join public.referral_pack_reward_lots lot on lot.id=opening.referral_reward_lot_id
  join public.cards c on c.id=provenance.card_id
  left join public.user_cards uc on uc.id=provenance.card_instance_id
  left join public.user_profiles opener on opener.user_id=opening.opened_by
  left join public.user_profiles referrer on referrer.user_id=opening.source_referrer_id
  left join public.user_profiles referred on referred.user_id=opening.source_referred_id
  left join public.anticheat_deleted_accounts opener_deleted on opener_deleted.user_id=opening.opened_by
  left join public.anticheat_deleted_accounts referrer_deleted on referrer_deleted.user_id=opening.source_referrer_id
  left join public.anticheat_deleted_accounts referred_deleted on referred_deleted.user_id=opening.source_referred_id
  where opening.source='referral_reward';
  return coalesce(result,'[]'::jsonb);
end;
$$;
revoke all on function public.admin_get_referral_pack_provenance(uuid[]) from public,anon,service_role;
grant execute on function public.admin_get_referral_pack_provenance(uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
