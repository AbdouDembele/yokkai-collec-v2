-- Approved catalogue audit: 15,406 AniList cards without any franchise link.
-- Fail closed if the exact UUID set differs from the reviewed CSV.
-- Storage files are deliberately preserved for recovery from the VPS backup.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  expected_count constant integer := 15406;
  expected_fingerprint constant text := '1b864d9b640237d59ee73772b348115d';
  target_card_ids uuid[] := '{}'::uuid[];
  target_instance_ids uuid[] := '{}'::uuid[];
  removed_copies integer := 0;
  removed_cards integer := 0;
begin
  select coalesce(array_agg(locked.id order by locked.id), '{}'::uuid[])
  into target_card_ids
  from (
    select c.id from public.cards c
    where upper(btrim(c.categorie)) = 'ANIME/MANGA'
      and c.source = 'anilist'
      and nullif(btrim(c.franchise), '') is null
      and not exists (select 1 from public.card_franchises links where links.card_id = c.id)
    order by c.id for update of c
  ) locked;

  -- Empty databases and a replay after removal are safe no-ops.
  if cardinality(target_card_ids) = 0 then return; end if;
  if cardinality(target_card_ids) <> expected_count
    or md5(array_to_string(target_card_ids, ',')) <> expected_fingerprint then
    raise exception 'AUDITED_CARD_SET_CHANGED: review the catalogue again before deleting';
  end if;

  perform id from public.user_cards
  where card_id = any(target_card_ids) order by id for update;
  select coalesce(array_agg(id order by id), '{}'::uuid[])
  into target_instance_ids from public.user_cards
  where card_id = any(target_card_ids);

  -- No active auction was present in the approved audit. Do not silently
  -- cancel a newly created sale or change player balances.
  if exists (
    select 1 from public.auctions
    where status = 'active' and card_instance_id = any(target_instance_ids)
  ) then
    raise exception 'AUDITED_CARDS_HAVE_ACTIVE_AUCTIONS: review before deleting';
  end if;

  update public.trade_offers
  set status = 'declined', updated_at = clock_timestamp()
  where status = 'pending' and (
    offered_card_ids && target_instance_ids or requested_card_ids && target_instance_ids
  );

  update public.user_profiles set banner_card_id = null
  where banner_card_id = any(target_card_ids);
  update public.user_profiles
  set featured_card_ids = array(
    select instance_id from unnest(featured_card_ids) as instance_id
    where instance_id <> all(target_instance_ids)
  ) where featured_card_ids && target_instance_ids;

  update public.decision_packs packs set kept_choice_id = null
  where kept_choice_id in (
    select choices.id from public.decision_pack_choices choices
    where choices.card_id = any(target_card_ids)
  );
  delete from public.card_shares where card_id = any(target_card_ids);
  delete from public.decision_pack_choices where card_id = any(target_card_ids);
  update public.user_cards set is_locked = false
  where id = any(target_instance_ids);
  delete from public.user_cards where card_id = any(target_card_ids);
  get diagnostics removed_copies = row_count;
  delete from public.cards where id = any(target_card_ids);
  get diagnostics removed_cards = row_count;
  if removed_cards <> expected_count then
    raise exception 'AUDITED_DELETE_COUNT_MISMATCH';
  end if;
  raise notice 'Removed % audited cards and % owned copies; Storage preserved.', removed_cards, removed_copies;
end;
$$;

commit;
