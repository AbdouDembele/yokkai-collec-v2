begin;

do $$
declare
  target_card_ids uuid[];
  target_instance_ids uuid[];
  active_auctions integer;
  pending_trades integer;
begin
  select coalesce(array_agg(id), '{}'::uuid[])
  into target_card_ids
  from public.cards
  where source = 'anilist'
    and source_id in ('2147', '4318', '2093', '2104', '2551');

  if cardinality(target_card_ids) = 0 then
    return;
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into target_instance_ids
  from public.user_cards
  where card_id = any(target_card_ids);

  select count(*)
  into active_auctions
  from public.auctions
  where status = 'active'
    and card_instance_id = any(target_instance_ids);

  if active_auctions <> 0 then
    raise exception 'Dragon Ball duplicate cards still have % active auction(s)', active_auctions;
  end if;

  select count(*)
  into pending_trades
  from public.trade_offers
  where status = 'pending'
    and (
      offered_card_ids && target_instance_ids
      or requested_card_ids && target_instance_ids
    );

  if pending_trades <> 0 then
    raise exception 'Dragon Ball duplicate cards still have % pending trade(s)', pending_trades;
  end if;

  update public.user_profiles
  set featured_card_ids = array(
    select instance_id
    from unnest(featured_card_ids) as instance_id
    where instance_id <> all(target_instance_ids)
  )
  where featured_card_ids && target_instance_ids;

  delete from public.decision_pack_choices
  where card_id = any(target_card_ids);

  delete from public.user_cards
  where card_id = any(target_card_ids);

  delete from public.cards
  where id = any(target_card_ids);
end;
$$;

update public.cards
set franchise = 'Dragon Ball'
where franchise = 'Dragon Ball Z';

update public.cards
set nom = case source_id
  when '2150' then 'C-13'
  when '2149' then 'C-14'
  when '2148' then 'C-15'
end
where franchise = 'Dragon Ball Z: Super Android 13!'
  and source = 'anilist'
  and source_id in ('2150', '2149', '2148');

update public.cards
set nom = 'C-19'
where franchise = 'Dragon Ball'
  and source = 'anilist'
  and source_id = '6115';

update public.cards
set nom = case source_id
  when '2114' then 'DIABLEMAN'
  when '2110' then 'BABA LA VOYANTE'
  when '2103' then 'DR BRIEF'
  when '2107' then 'MADAME BRIEF'
  when '315769' then U&'PR\00C9SENTATEUR DU CELL GAME'
  when '32466' then 'ROI COLD'
  when '41526' then 'GRAND KAIO'
  when '9780' then 'GRAND KAIO SHIN'
  when '9773' then 'ROI ENMA'
  when '3694' then 'FREEZER'
  when '246' then 'SON GOKU'
  when '2094' then 'GYUMAO'
  when '41528' then 'KAIO DE L''EST'
  when '6133' then 'KAIO SHIN DE L''EST'
  when '2099' then 'C-16'
  when '2098' then 'C-8'
  when '4850' then 'KAIO DU NORD'
  when '148620' then 'KAIO SHIN DU NORD'
  when '2159' then 'KRILIN'
  when '1012' then 'BOO'
  when '2134' then 'SERGENT METALLIC'
  when '41529' then 'KAIO DU SUD'
  when '9377' then 'MR. SATAN'
  when '41888' then U&'GAR\00C7ON AVEUGLE'
  when '6167' then U&'TORTUE G\00C9NIALE'
  when '41527' then 'KAIO DE L''OUEST'
  when '40489' then 'FERMIER'
  when '332777' then U&'GRAND-M\00C8RE PAOZU'
  when '6293' then 'VIEUX KAIO SHIN'
  when '2115' then 'OURS BANDIT'
  when '6127' then 'SHENRON'
  when '2109' then U&'PR\00C9SENTATEUR DU TENKAICHI BUDOKAI'
  when '2130' then U&'MA\00CETRE DES GRUES'
  when '2112' then 'TORTUE'
  when '9393' then 'ROI VEGETA'
  when '21344' then 'ROI NIKOCHAN'
  when '332776' then 'MEMBRE DU GANG DES LAPINS'
  when '332778' then 'MEMBRE DU GANG DES LAPINS'
end
where franchise = 'Dragon Ball'
  and source = 'anilist'
  and source_id in (
    '2114','2110','2103','2107','315769','32466','41526','9780','9773',
    '3694','246','2094','41528','6133','2099','2098','4850','148620',
    '2159','1012','2134','41529','9377','41888','6167','41527','40489',
    '332777','6293','2115','6127','2109','2130','2112','9393','21344',
    '332776','332778'
  );

commit;
