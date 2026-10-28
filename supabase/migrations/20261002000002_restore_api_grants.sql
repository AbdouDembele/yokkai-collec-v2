-- Restore the API grants declared by earlier migrations (applied manually in prod on 2026-10-02).
-- The self-hosted restore of 2026-09-26 re-created pre-existing public objects under Supabase's
-- default privileges without their revokes: anon/authenticated could execute every function
-- (credit_karas, debit_karas, settle_expired_auctions...) and held ALL on every table.
-- Idempotent: re-asserts the end state of the migration history. Trigger functions and
-- is_pseudo_available keep their PUBLIC execute and are left untouched.
begin;

revoke all on table
  public.achievements, public.auction_watchers, public.auctions, public.bids,
  public.card_categories, public.cards, public.decision_pack_choices, public.decision_packs,
  public.folders, public.friendships, public.notifications, public.trade_offers,
  public.user_achievement_stats, public.user_achievements, public.user_cards,
  public.user_profiles, public.wishlists
from public, anon, authenticated;

grant select on table public.cards to anon, authenticated;
grant select on table public.achievements, public.folders, public.notifications,
  public.user_achievements, public.user_cards, public.wishlists to authenticated;

-- Internal functions: server only (owner and service_role keep access).
revoke all on function
  public.achievement_progress(uuid,text), public.card_destruction_value(public.card_rarity),
  public.complete_achievements(uuid,text[]), public.credit_karas(uuid,integer),
  public.debit_karas(uuid,integer), public.decision_pack_cards(uuid),
  public.ensure_achievement_stats(uuid), public.friendship_state(uuid,uuid),
  public.handle_new_user_profile(), public.notify_friend_request(),
  public.notify_wishlist_auction(), public.profile_card_json(public.cards,public.user_cards),
  public.remove_owned_card_from_wishlist(), public.settle_expired_auctions(),
  public.trade_card_json(uuid[])
from public, anon, authenticated;

-- Player RPCs: authenticated only.
revoke all on function
  public.claim_achievement(text), public.create_auction(uuid,integer,integer),
  public.create_folder(text), public.create_trade_offer(uuid,uuid[],integer,uuid[],integer,uuid),
  public.delete_folder(uuid), public.discard_collection_card(uuid),
  public.discard_decision_pack_card(uuid), public.discard_regular_pack_card(uuid),
  public.evolve_ssr_card(uuid), public.get_achievements(), public.get_auction(uuid),
  public.get_card_discovery(uuid,integer,integer), public.get_decision_pack_status(),
  public.get_friendships(), public.get_game_info(), public.get_pack_destruction_values(uuid[]),
  public.get_profile(text), public.get_public_profile(uuid), public.get_regular_pack_status(),
  public.get_trade_context(uuid), public.keep_decision_pack_card(uuid), public.list_auctions(),
  public.list_notifications(integer), public.list_trade_offers(), public.list_wishlist(text),
  public.mark_notification_read(uuid), public.move_card_to_folder(uuid,uuid),
  public.open_decision_pack(), public.open_regular_pack(), public.place_bid(uuid,integer),
  public.respond_friend_request(uuid,boolean), public.respond_trade_offer(uuid,text),
  public.search_cards(text,integer), public.search_users(text), public.send_friend_request(uuid),
  public.set_card_custom_image(uuid,text), public.toggle_auction_watch(uuid),
  public.toggle_wishlist(uuid), public.update_profile(text,text,uuid[],uuid)
from public, anon, authenticated;

grant execute on function
  public.claim_achievement(text), public.create_auction(uuid,integer,integer),
  public.create_folder(text), public.create_trade_offer(uuid,uuid[],integer,uuid[],integer,uuid),
  public.delete_folder(uuid), public.discard_collection_card(uuid),
  public.discard_decision_pack_card(uuid), public.discard_regular_pack_card(uuid),
  public.evolve_ssr_card(uuid), public.get_achievements(), public.get_auction(uuid),
  public.get_card_discovery(uuid,integer,integer), public.get_decision_pack_status(),
  public.get_friendships(), public.get_game_info(), public.get_pack_destruction_values(uuid[]),
  public.get_profile(text), public.get_public_profile(uuid), public.get_regular_pack_status(),
  public.get_trade_context(uuid), public.keep_decision_pack_card(uuid), public.list_auctions(),
  public.list_notifications(integer), public.list_trade_offers(), public.list_wishlist(text),
  public.mark_notification_read(uuid), public.move_card_to_folder(uuid,uuid),
  public.open_decision_pack(), public.open_regular_pack(), public.place_bid(uuid,integer),
  public.respond_friend_request(uuid,boolean), public.respond_trade_offer(uuid,text),
  public.search_cards(text,integer), public.search_users(text), public.send_friend_request(uuid),
  public.set_card_custom_image(uuid,text), public.toggle_auction_watch(uuid),
  public.toggle_wishlist(uuid), public.update_profile(text,text,uuid[],uuid)
to authenticated;

commit;
