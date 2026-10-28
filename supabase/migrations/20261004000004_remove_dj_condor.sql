begin;

do $$
declare
  target_id uuid;
  matching_cards integer;
  linked_auctions integer;
begin
  select count(*)
  into matching_cards
  from public.cards
  where id = '7681348b-0143-4079-86f0-3626dda7cc21'
    and nom = 'DJ CONDOR'
    and source = 'anilist'
    and source_id = '41782';

  if matching_cards = 0 then
    return;
  end if;
  if matching_cards <> 1 then
    raise exception 'Expected exactly one DJ CONDOR card, found %', matching_cards;
  end if;

  target_id := '7681348b-0143-4079-86f0-3626dda7cc21';

  select count(*) into linked_auctions
  from public.auctions as auctions
  join public.user_cards as owned on owned.id = auctions.card_instance_id
  where owned.card_id = target_id;

  if linked_auctions <> 0 then
    raise exception 'DJ CONDOR still has % linked auction(s)', linked_auctions;
  end if;

  update public.user_profiles
  set banner_card_id = null
  where banner_card_id = target_id;

  delete from public.decision_pack_choices where card_id = target_id;
  delete from public.user_cards where card_id = target_id;
  delete from public.cards where id = target_id;
end;
$$;

commit;
