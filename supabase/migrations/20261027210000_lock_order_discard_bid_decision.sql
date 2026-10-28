begin;
set local lock_timeout='3s';

-- Lock order audit after #390: every path takes the auction / offer / pack row,
-- then profiles by user_id, then cards by id (respond_trade_offer, place_bid,
-- settle_expired_auctions, open_decision_pack).
-- * Card destruction (discard_collection_card(s), discard_regular_pack_card)
--   deleted the card(s) before crediting the profile: reversed against a trade
--   accept on the same card. Now: profile, then cards ordered by id.
-- * place_bid settled other expired auctions inline (their profiles and cards)
--   before locking its own auction. The every-minute cron settles them, and the
--   ends_at check already refuses a bid on an expired auction.
-- * keep_decision_pack_card / discard_decision_pack(_card) locked the pack before
--   the profile (credit_karas), reversed against open_decision_pack.
-- Bodies are otherwise unchanged: same amounts, error codes and ban guard first.

CREATE OR REPLACE FUNCTION public.discard_collection_card(p_card_instance_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_player_not_banned();

declare player_id uuid:=auth.uid();discarded_rarity public.card_rarity;reward integer;balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform 1 from public.user_profiles where user_id=player_id for update;
  perform 1 from public.user_cards where id=p_card_instance_id and user_id=player_id for update;
  delete from public.user_cards where id=p_card_instance_id and user_id=player_id returning rarity into discarded_rarity;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  reward:=public.card_destruction_value(discarded_rarity);
  update public.user_profiles set karas_balance=karas_balance+reward where user_id=player_id returning karas_balance into balance;
  if not found then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;
  return balance;
end;
end
$function$;

CREATE OR REPLACE FUNCTION public.discard_collection_cards(p_card_instance_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_player_not_banned();

declare
  player_id uuid := auth.uid();
  requested_count integer;
  deleted_count integer;
  total_reward integer;
  balance integer;
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  requested_count := cardinality(p_card_instance_ids);
  if requested_count is null or requested_count = 0 then
    raise exception 'CARD_SELECTION_EMPTY' using errcode = 'P0001';
  end if;
  if requested_count > 2000 then
    raise exception 'CARD_SELECTION_TOO_LARGE' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_card_instance_ids) instance_id where instance_id is null)
    or (select count(distinct instance_id) from unnest(p_card_instance_ids) instance_id) <> requested_count then
    raise exception 'CARD_SELECTION_INVALID' using errcode = 'P0001';
  end if;

  perform 1 from public.user_profiles where user_id = player_id for update;
  perform 1 from public.user_cards
  where user_id = player_id and id = any(p_card_instance_ids)
  order by id for update;

  with deleted as (
    delete from public.user_cards
    where user_id = player_id and id = any(p_card_instance_ids)
    returning rarity
  )
  select count(*)::integer,
    coalesce(sum(public.card_destruction_value(rarity)), 0)::integer
  into deleted_count, total_reward
  from deleted;

  -- Raising here rolls the whole function back: a stale or foreign ID can never
  -- cause a partial bulk destruction.
  if deleted_count <> requested_count then
    raise exception 'CARD_NOT_OWNED' using errcode = 'P0001';
  end if;

  update public.user_profiles
  set karas_balance = karas_balance + total_reward
  where user_id = player_id
  returning karas_balance into balance;
  if not found then
    raise exception 'PROFILE_MISSING' using errcode = 'P0001';
  end if;

  return balance;
end;
end
$function$;

CREATE OR REPLACE FUNCTION public.discard_regular_pack_card(p_card_instance_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_player_not_banned();

declare reward integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform 1 from public.user_profiles where user_id=auth.uid() for update;
  select public.card_destruction_value(owned.rarity) into reward
    from public.user_cards owned
    where owned.id=p_card_instance_id and owned.user_id=auth.uid()
    for update of owned;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  delete from public.user_cards where id=p_card_instance_id and user_id=auth.uid();
  perform public.credit_karas(auth.uid(),reward);
end;
end
$function$;

CREATE OR REPLACE FUNCTION public.place_bid(p_auction_id uuid, p_amount integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_player_not_banned();

declare player_id uuid:=auth.uid(); sale public.auctions%rowtype; old_buyer uuid; old_price integer; balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select * into sale from public.auctions where id=p_auction_id for update;
  if not found or sale.status<>'active' or sale.ends_at<=clock_timestamp() then raise exception 'AUCTION_CLOSED' using errcode='P0001'; end if;
  if sale.seller_id=player_id then raise exception 'SELLER_CANNOT_BID' using errcode='P0001'; end if;
  if p_amount<sale.current_price+10 then raise exception 'BID_TOO_LOW' using errcode='P0001'; end if;
  old_buyer:=sale.buyer_id; old_price:=sale.current_price;
  -- Both the debit and refund lock these rows: always acquire them by UUID.
  perform 1 from public.user_profiles
    where user_id in (player_id,old_buyer)
    order by user_id for no key update;
  if old_buyer=player_id then balance:=public.debit_karas(player_id,p_amount-old_price);
  else
    balance:=public.debit_karas(player_id,p_amount);
    if old_buyer is not null then perform public.credit_karas(old_buyer,old_price); end if;
  end if;
  update public.auctions set current_price=p_amount,buyer_id=player_id,
    ends_at=case when ends_at-clock_timestamp()<interval '5 minutes' then ends_at+interval '1 minute' else ends_at end
    where id=p_auction_id returning * into sale;
  insert into public.bids(auction_id,bidder_id,amount) values(p_auction_id,player_id,p_amount);
  if old_buyer is not null and old_buyer<>player_id then
    insert into public.notifications(user_id,type,reference_id)
      values(old_buyer,'outbid',p_auction_id)
      on conflict (user_id,type,reference_id) do update
        set read_at=null,created_at=clock_timestamp();
  end if;
  return jsonb_build_object('currentPrice',sale.current_price,'endsAt',sale.ends_at,'balance',balance);
end;
end
$function$;

CREATE OR REPLACE FUNCTION public.keep_decision_pack_card(p_choice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_player_not_banned();

declare player_id uuid:=auth.uid();choice record;copy_id uuid;kept_at timestamptz:=clock_timestamp();reward integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform 1 from public.user_profiles where user_id=player_id for update;
  select choices.*,cards.nom,cards.categorie,cards.franchise,cards.image_url into choice
    from public.decision_pack_choices choices
    join public.decision_packs packs on packs.id=choices.pack_id
    join public.cards cards on cards.id=choices.card_id
    where choices.id=p_choice_id and packs.user_id=player_id and packs.status='pending'
    for update of packs,choices;
  if not found or choice.is_discarded then raise exception 'DECISION_CHOICE_UNAVAILABLE' using errcode='P0001'; end if;
  select coalesce(sum(public.card_destruction_value(other_choices.rarity)),0)::integer into reward
    from public.decision_pack_choices other_choices
    where other_choices.pack_id=choice.pack_id and other_choices.id<>choice.id and not other_choices.is_discarded;
  insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    values(player_id,choice.card_id,kept_at,choice.rarity,choice.is_shiny,false,choice.rarity='LR') returning id into copy_id;
  update public.decision_pack_choices set is_discarded=true where pack_id=choice.pack_id and id<>choice.id and not is_discarded;
  update public.decision_packs set status='claimed',claimed_at=kept_at,kept_choice_id=choice.id where id=choice.pack_id;
  if reward <> 0 then
    perform public.credit_karas(player_id,reward);
  end if;
  return jsonb_build_object('id',choice.card_id,'name',choice.nom,'category',choice.categorie,'liveFranchise',true,'anime',choice.franchise,
    'rarity',choice.rarity,'image',choice.image_url,'catalogueImage',choice.image_url,'customImageUrl',null,
    'instanceId',copy_id,'obtainedAt',kept_at,'shiny',choice.is_shiny,'isEvolved',false,
    'isFirstOwner',choice.rarity='LR','folderId',null,'karasReward',reward);
end;
end
$function$;

CREATE OR REPLACE FUNCTION public.discard_decision_pack_card(p_choice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_player_not_banned();

declare
  target_pack uuid;
  discarded_rarity public.card_rarity;
  remaining integer;
  reward integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  perform 1 from public.user_profiles where user_id = auth.uid() for update;
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
end
$function$;

CREATE OR REPLACE FUNCTION public.discard_decision_pack()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_player_not_banned();

declare
  player_id uuid := auth.uid();
  target_pack uuid;
  reward integer;
  completed_at timestamptz := clock_timestamp();
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  perform 1 from public.user_profiles where user_id = player_id for update;

  select packs.id into target_pack
  from public.decision_packs as packs
  where packs.user_id = player_id and packs.status = 'pending'
  for update;

  if not found then
    raise exception 'DECISION_PACK_NOT_PENDING' using errcode = 'P0001';
  end if;

  select coalesce(sum(public.card_destruction_value(choices.rarity)), 0)::integer
  into reward
  from public.decision_pack_choices as choices
  where choices.pack_id = target_pack and not choices.is_discarded;

  if reward <= 0 then
    raise exception 'DECISION_PACK_NOT_PENDING' using errcode = 'P0001';
  end if;

  update public.decision_pack_choices
  set is_discarded = true
  where pack_id = target_pack and not is_discarded;

  update public.decision_packs
  set status = 'claimed', claimed_at = completed_at, kept_choice_id = null
  where id = target_pack;

  perform public.credit_karas(player_id, reward);
  return reward;
end;
end
$function$;

commit;
