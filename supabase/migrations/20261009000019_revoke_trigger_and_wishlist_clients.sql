begin;

-- Trigger execution does not require the invoking player's EXECUTE privilege.
revoke all on function public.normalize_card_category(),public.normalize_card_name(),
  public.prevent_frozen_card_change(),public.prevent_locked_card_transfer_or_delete(),
  public.prevent_locked_trade_offer() from public,anon,authenticated;

-- Keep this compatibility view: respond_trade_offer and settle_expired_auctions
-- still use it as postgres. Players use the dedicated wishlist RPCs instead.
revoke all on table public.wishlist from public,anon,authenticated;

commit;
