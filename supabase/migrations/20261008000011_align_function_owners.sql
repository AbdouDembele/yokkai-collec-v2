begin;

-- One-time production transfer: run as the current owner, supabase_admin.
-- Subsequent migrations should run as postgres. ALTER OWNER also folds the
-- existing explicit postgres EXECUTE into owner privileges; no REVOKE is needed.
alter function public.can_view_collection(uuid, uuid) owner to postgres;
alter function public.discard_collection_card(uuid) owner to postgres;
alter function public.get_friend_collection(uuid) owner to postgres;
alter function public.get_my_active_auction_cards() owner to postgres;
alter function public.get_pack_destruction_values(uuid[]) owner to postgres;
alter function public.get_profile_privacy() owner to postgres;
alter function public.notify_auction_sold() owner to postgres;
alter function public.prevent_locked_card_transfer_or_delete() owner to postgres;
alter function public.prevent_locked_trade_offer() owner to postgres;
alter function public.remove_friend(uuid) owner to postgres;
alter function public.set_collection_card_locked(uuid, boolean) owner to postgres;
alter function public.set_profile_privacy(boolean) owner to postgres;

commit;
