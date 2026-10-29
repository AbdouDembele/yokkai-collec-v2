begin;
set local lock_timeout='3s';

-- Explicit wishlist intent survives acquisitions (duplicates are useful for evolution).
-- Binder bulk-add still targets missing cards only; RLS and notifications stay intact.
create or replace function public.toggle_wishlist(p_card_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); removed uuid;
begin
  perform public.assert_player_not_banned();
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.cards where id=p_card_id) then raise exception 'CARD_NOT_FOUND' using errcode='P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(player_id::text || ':' || p_card_id::text, 0));
  delete from public.wishlists where user_id=player_id and card_id=p_card_id returning card_id into removed;
  if removed is not null then return false; end if;
  insert into public.wishlists(user_id,card_id) values(player_id,p_card_id);
  return true;
end; $$;
revoke all on function public.toggle_wishlist(uuid) from public,anon;
grant execute on function public.toggle_wishlist(uuid) to authenticated;

-- An acquisition no longer consumes wishlist intent. Keep the trigger function
-- as a harmless no-op so existing callers and its privileges stay stable.
create or replace function public.remove_owned_card_from_wishlist()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  return new;
end; $$;

-- Older auction/trade RPCs also contained redundant cleanup statements.
-- Remove only those statements from their CURRENT definitions, preserving
-- security guards, signatures, ownership, grants and transfer/locking rules.
do $keep_wishes$
declare target regprocedure; definition text; cleanup text; updated text;
begin
  foreach target in array array['public.settle_expired_auctions()'::regprocedure,'public.respond_trade_offer(uuid,text)'::regprocedure] loop
    select pg_catalog.pg_get_functiondef(target) into definition;
    cleanup:=case when target='public.settle_expired_auctions()'::regprocedure then
      'delete from public[.]wishlist where user_id=sale[.]buyer_id[[:space:]]+and card_id=\(select card_id from public[.]user_cards where id=sale[.]card_instance_id\);'
    else
      'delete from public[.]wishlist w where \(w[.]user_id=offer[.]to_user and w[.]card_id in \(select card_id from public[.]user_cards where id=any\(offer[.]offered_card_ids\)\)\)[[:space:]]+or \(w[.]user_id=offer[.]from_user and w[.]card_id in \(select card_id from public[.]user_cards where id=any\(offer[.]requested_card_ids\)\)\);'
    end;
    updated:=pg_catalog.regexp_replace(definition,cleanup,'-- Wishlist intent survives acquisition.');
    if updated=definition or updated ~* 'delete[[:space:]]+from[[:space:]]+public[.]wishlists?' then
      raise exception 'UNEXPECTED_WISHLIST_CLEANUP_DEFINITION: %',target;
    end if;
    execute updated;
  end loop;
end $keep_wishes$;

commit;
