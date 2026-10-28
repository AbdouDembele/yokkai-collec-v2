// Exact overloads and roles only. Every addition requires an access justification.
export const ownerOnly = [
  "public.guard_trade_offer_submission()", // Trigger-only transactional anti-spam admission; no API or service-role execution.
  "public.leaderboard_collection_without_styles(integer, integer, text, boolean)", // Internal score/visibility projection; only the public entitlement-aware leaderboard wrapper can execute it.
  "public.leaderboard_referrals_without_styles(integer, integer, text, boolean)", // Internal referral projection; no direct API access, cosmetics appended only after the wrapper's authorized page is known.
  "public.collection_ranked_copies(uuid, text, text[], text[], boolean, text, boolean, boolean, text)", // Internal filtered/ranked copies of one player; only the own-collection page, counts and copies wrappers (auth.uid()).
  "public.guard_gif_rating()", // Trigger-only GIF rating fence on player writes (#379); no API entry point.
  "public.guard_wall_media_cleanup()", // Trigger-only binding/upload cleanup fence; no API entry point.
  "public.lock_friend_request_pair(uuid, uuid)", // Internal account-deletion shared fences before the existing social pair lock; never an API entry point.
  "public.dismiss_friend_request_notification()", // Trigger-only removal of the exact resolved request notification; no API access.
  "public.wall_reply_author_visible(uuid)", // Internal reply-only actor guard: active account and bilateral blocks, never profile-wall privacy; parent ACL checked by callers.
  "public.wall_post_interaction_allowed(uuid, uuid)", // Internal common post ACL for read/mutation/report/media/notification wrappers; no API execution.
  "public.delete_wall_content_core(text, uuid)", // Shared deletion/cascade mechanics; only owner-checked player and admin-only report wrappers.
  "public.build_data_export_without_binders(uuid, uuid)", // Existing export body: callable only by the owning reservation-gated wrapper.
  "public.build_data_export_without_referrals(uuid, uuid)", // New internal snapshot helper: only the owning export wrapper, never service_role or players.
  "public.guard_wall_media_binding()",
  "public.build_data_export_without_reply_media(uuid, uuid)",
  "public.notify_wall_post_reply()",
  "public.cleanup_wall_reply_notifications()",
  "public.prepare_account_deletion_without_billing(uuid)",
  "public.build_data_export_without_wall_interactions(uuid, uuid)",
  "public.wall_actor_visible(uuid)",
  "public.wall_interaction_owner(uuid)",
  "public.cleanup_wall_interactions()",
  "public.get_wall_post_activity_without_reactions(uuid, timestamp with time zone, uuid)",
  "public.build_data_export_without_reactions(uuid, uuid)",
  "public.cleanup_wall_reactions()"
]; // Internal helpers: owning SECURITY DEFINER wrappers/triggers only, never service_role or players.

export const serverOnly = {
  "public.record_giphy_gif_rating(text, text)": ["service_role"], // Trusted GIF verification route only: records the rating GIPHY returned for a validated id; no browser access.
  "public.get_orphan_wall_media(text, boolean)": ["service_role"] // Operator inventory/claim only, 24h grace, exact-object fences; no browser access.
};

const allowlist = {
  "public.get_my_locale()": ["authenticated"], // Only the JWT owner's nullable locale; no target identifier.
  "public.set_my_locale(text)": ["authenticated"], // Validated en/fr/NULL update on auth.uid() only.
  "public.assert_player_not_banned()": ["authenticated"], // Reads only the caller's own auth.users ban state; raises ACCOUNT_BANNED. Needed by SECURITY INVOKER wrappers and Storage policies.
  "public.authorize_wall_reply_media_cleanup(text)": ["authenticated"], // Only own moderator receipt for an exact unbound storage object; trusted server cleanup, no broad storage read/delete grant.

  "public.get_public_wall_feed(timestamp with time zone, uuid, integer)": [
    "authenticated"
  ], // Bounded live public-wall projection; requires active viewer and enforces privacy, deletion and bilateral blocks.
  "public.cancel_friend_request(uuid)": ["authenticated"], // Caller can delete only their own pending outgoing request, under the existing social pair lock.
  "public.get_wall_posts_activity(uuid[])": ["authenticated"], // Maximum 20 posts; delegates each ACL and activity projection to the existing unit reader, omitting unavailable posts.

  "public.admin_delete_reported_wall_content(uuid)": ["authenticated"], // Admin predicate, existing wall report only, atomic audit; private cleanup paths for trusted server Storage removal and retry.
  "public.admin_moderate_reported_content(uuid)": ["authenticated"], // Admin predicate, reported DM or wall item by its reported author only; hides content, atomic audit; private cleanup paths for trusted server Storage removal.
  "public.admin_get_reported_wall_media(uuid)": ["authenticated"], // Admin predicate, read-only current media path of a reported wall item for the private admin preview route.
  "public.get_binder_albums_page(uuid, text, text, boolean, integer, integer)":
    ["authenticated"], // Exact caller/friend can_view_collection ACL; no anonymous ownership or preference access.
  "public.get_binder_cards_page(uuid, text, text, text, text, boolean, integer, integer)":
    ["authenticated"], // Same owner/friend ACL, exact stable key, bounded page; source metadata unchanged.
  "public.get_binder_cards_page(uuid, text, text, text, text, boolean, integer, integer, text)":
    ["authenticated"], // Same collection visibility, stable key and page cap; adds an allowlisted sort before pagination.
  "public.set_binder_favorite(text, boolean)": ["authenticated"], // Only auth.uid()'s preference, live catalogue key, account access check.
  "public.add_binder_to_wishlist(text)": ["authenticated"], // auth.uid()'s own wishlist only; unowned cards of one binder key or license, idempotent insert.
  "public.resolve_binder_favorite(text, text[])": ["authenticated"], // Own existing legacy favorite and only its actual candidate keys; raw preference retained.
  "public.get_card_binder_metadata(uuid[])": ["anon", "authenticated"], // Public catalogue labels only, maximum 500 card IDs; never proofs or player data.
  "public.get_binder_catalogue_totals()": ["anon", "authenticated"], // Public catalogue counts, no player/ownership data.
  "public.get_binder_catalogue_page(text, text, text, integer, integer, text)":
    ["anon", "authenticated"], // Existing public catalogue scope, bounded search and source-preserving rows.
  "public.get_profile_binders_page(text, text, integer, integer)": [
    "authenticated"
  ], // Bounded public catalogue choices for own widget editor, no preferences.
  "public.set_profile_binder_widgets(jsonb)": ["authenticated"], // Own profile only, bounded category/key validation; historical widgets retained.
  "public.get_profile_details_with_binders(text)": ["authenticated"], // Delegates existing profile/block/ban ACL and canViewCollection before favorite progress.
  "public.evolve_lr_card(uuid[])": ["authenticated"], // Three owned identical normal LR copies only; stable row locks, Shiny/evolved/locked/auction exclusions and atomic replacement.
  "public.publish_wall_post_reply_media(uuid, uuid, text, text, text)": [
    "authenticated"
  ], // Same friend/self wall ACL, bounded own reply and rate limits; one validated own private upload or allowlisted GIF. Walid review required.
  "public.get_wall_reply_media(uuid)": ["authenticated"], // Narrow attachment path only after parent post and reply author live ACL; no table SELECT or service bypass.
  "public.wall_reply_media_access(text, boolean)": ["authenticated"], // Storage policy predicate: same parent/author ACL for reads, only caller-owned unreferenced reply uploads for deletion.
  "public.get_home_wall_feed(timestamp with time zone, uuid, integer)": [
    "authenticated"
  ], // Home timeline: auth.uid()'s own wall plus accepted friends, same live wall ACL, bans/deletion fences and bounded cursor. Walid review required.
  "public.set_wall_post_reaction(uuid, text, boolean)": ["authenticated"], // Allowed emoji only, own desired state, live friend/self post ACL, serialized maximum 8 reactions per post. Walid review required.
  "public.get_wall_post_activity(uuid, timestamp with time zone, uuid)": [
    "authenticated"
  ], // Accepted friend/self post; live wall ACL and filtered reply authors, bounded page. Walid review required.
  "public.set_wall_post_like(uuid, boolean)": ["authenticated"], // Idempotent desired state for auth.uid() only; same post ACL.
  "public.publish_wall_post_reply(uuid, uuid, text)": ["authenticated"], // Own bounded text reply, idempotent UUID, serialized rate limit, same post ACL.
  "public.delete_wall_post_reply(uuid, uuid)": ["authenticated"], // Only auth.uid()'s own reply on an accessible post.
  "public.get_friend_wall_feed(timestamp with time zone, uuid, integer)": [
    "authenticated"
  ], // Bounded accepted-friend wall feed for auth.uid(); existing wall ACL, bilateral blocks, bans and deletion fences. Requires Walid ACL review before production.
  "public.get_recent_big_pulls(integer)": ["authenticated"], // Bounded public pulls; private identity/appearance are null, blocked/banned/deleted players excluded.
  "public.browse_auctions_page(integer, text, text, text, text, text)": [
    "authenticated"
  ], // Bounded market prefixes, same viewer visibility as list_auctions_page; no anonymous access. Requires Walid ACL review.
  "public.admin_get_player(uuid)": ["authenticated"], // Admin-only account and inventory projection.
  "public.admin_list_players(text, integer, integer)": ["authenticated"], // Admin-only paginated account search.
  "public.admin_remove_player_card(uuid)": ["authenticated"], // Admin-only removal of one owned copy, including safe auction cancellation.
  "public.admin_set_user_ban(uuid, boolean)": ["authenticated"], // Admin-only moderation action with self/admin protection.
  "public.admin_search_reports(text, text, integer, integer)": [
    "authenticated"
  ], // Admin-only enriched report dashboard.
  "public.admin_search_card_reports(text, text, integer, integer)": [
    "authenticated"
  ], // Admin-only catalogue report dashboard.
  "public.admin_card_reference_counts(uuid)": ["authenticated"], // Admin RPC checks administrator status before reading references.
  "public.admin_delete_card(uuid)": ["authenticated"], // Admin-only atomic catalogue deletion cleans owned copies and related activity.
  "public.admin_delete_cards(uuid[])": ["authenticated"], // Admin-only atomic bulk deletion; same internal helper as admin_delete_card.
  "public.admin_preview_delete_cards(uuid[])": ["authenticated"], // Admin-only read-only impact preview before bulk deletion.
  "public.admin_list_reports(text, integer, integer)": ["authenticated"], // Moderation RPC checks administrator status.
  "public.admin_set_report_status(uuid, text)": ["authenticated"], // Moderation update checks administrator status.
  "public.admin_set_card_report_status(uuid, text)": ["authenticated"], // Card moderation update checks administrator status.
  "public.block_user(uuid)": ["authenticated"], // Player can block users for their own account.
  "public.cancel_auction(uuid)": ["authenticated"], // Seller can cancel their own eligible auction.
  "public.cancel_trade_offer(uuid)": ["authenticated"], // Participant can cancel their own eligible trade.
  "public.claim_achievement(text)": ["authenticated"], // Player claims their own completed achievement reward.
  "public.create_auction(uuid, integer, integer)": ["authenticated"], // Player lists an owned eligible card.
  "public.create_card_share(uuid, boolean)": ["authenticated"], // Player shares their own card.
  "public.create_folder(text)": ["authenticated"], // Player creates their own collection folder.
  "public.create_referral_code()": ["authenticated"], // Creates or returns only auth.uid()'s opaque referral code.
  "public.create_trade_offer(uuid, uuid[], integer, uuid[], integer, uuid)": [
    "authenticated"
  ], // Player proposes a validated trade with owned assets.
  "public.delete_card_share(text)": ["authenticated"], // Owner revokes their card share.
  "public.delete_folder(uuid)": ["authenticated"], // Owner removes their folder.
  "public.discard_collection_card(uuid)": ["authenticated"], // Player discards their own eligible card.
  "public.discard_collection_cards(uuid[])": ["authenticated"], // Player atomically discards one validated batch of their own cards.
  "public.discard_decision_pack()": ["authenticated"], // Player atomically sells every remaining choice in their own pending Decision Pack.
  "public.discard_decision_pack_card(uuid)": ["authenticated"], // Player discards their own decision pack choice.
  "public.discard_regular_pack_card(uuid)": ["authenticated"], // Player discards their own regular pack card.
  "public.evolve_ssr_card(uuid[])": ["authenticated"], // Player evolves validated owned copies.
  "public.get_achievements()": ["authenticated"], // Reads the current player's achievement progress.
  "public.get_auction(uuid)": ["authenticated"], // Marketplace detail with viewer access checks.
  "public.get_auction_chat(uuid)": ["authenticated"], // Auction chat read checks viewer eligibility.
  "public.get_card_discovery(uuid, integer, integer)": ["authenticated"], // Discovery exposes permitted collector information.
  "public.get_decision_pack_status()": ["authenticated"], // Reads the current player's pack state.
  "public.get_friend_collection(uuid)": ["authenticated"], // Collection read enforces friendship and privacy.
  "public.get_friend_panini_album_cards_page(uuid, text, text, text, boolean, integer, integer)":
    ["authenticated"], // Panini card progress enforces the same collection privacy before reading another player.
  "public.get_friend_panini_album_cards_page(uuid, text, text, text, boolean, integer, integer, text)":
    ["authenticated"], // Rarity-filtered pages retain collection privacy and expose only the requested owner's progress.
  "public.get_friend_panini_albums_page(uuid, text, text, integer, integer)": [
    "authenticated"
  ], // Panini album progress enforces the same collection privacy before reading another player.
  "public.get_friendships()": ["authenticated"], // Reads the current player's social relationships.
  "public.get_friendships_page(jsonb, integer)": ["authenticated"], // Bounded pages only expose auth.uid() relationships, preserving the existing privacy and ordering.
  "public.get_game_info()": ["authenticated"], // Narrow access to the current player's balance and game state.
  "public.get_my_active_auction_cards()": ["authenticated"], // Reads the current player's auctioned cards.
  "public.get_pack_destruction_values(uuid[])": ["authenticated"], // Estimates rewards for the player's eligible cards.
  "public.get_profile(text)": ["authenticated"], // Profile view applies viewer privacy rules.
  "public.can_read_profile_wall(uuid)": ["authenticated"], // RLS helper uses auth.uid(); dynamic profile privacy, accepted friends, bilateral blocks and deletion fence.
  "public.get_profile_wall(uuid, timestamp with time zone, uuid, integer)": [
    "authenticated"
  ], // Bounded keyset pages of permitted wall posts only; no anon or private-wall bypass.
  "public.get_private_messages(uuid, timestamp with time zone, uuid, integer)":
    ["authenticated"], // Only auth.uid() and an accepted, unblocked friend; bounded conversation pages.
  "public.get_private_conversations(timestamp with time zone, uuid, integer)": [
    "authenticated"
  ], // Only auth.uid() conversations with accepted, unblocked, active friends; bounded keyset pages and sanitized previews, never marks read.
  "public.get_social_unread()": ["authenticated"], // Only auth.uid() unread aggregates; accepted, unblocked conversations and valid incoming requests.
  "public.mark_private_messages_read(uuid, uuid)": ["authenticated"], // Only auth.uid(); verifies incoming message ownership, social/deletion locks and monotonic read watermark.
  "public.send_private_message(uuid, text, uuid)": ["authenticated"], // Sender is auth.uid(); accepted friendship, blocks, deletion fence, rate limit and idempotency checked server-side.
  "public.send_private_message_gif(uuid, text, uuid, text)": ["authenticated"], // Same conversation authorization, shared sender limits and idempotency; only allowlisted HTTPS GIPHY media URLs, no uploads.
  "public.publish_profile_wall_post(uuid, text, text, text)": ["authenticated"], // Idempotent own posts only, bounded text/rate/count and owner-scoped private media.
  "public.delete_profile_wall_post(uuid)": ["authenticated"], // Author deletes only their own post; private attachment cleanup stays owner-scoped.
  "public.get_profile_details(text)": ["authenticated"], // Calls get_profile first; inventory, activity and favorites obey its collection privacy; mutual friends obey friendsVisible.
  "public.get_profile_active_auctions(uuid, jsonb, integer)": ["authenticated"], // Read-only bounded seller feed; collection privacy, bilateral blocks and deletion fences; no new bidding rights.
  "public.get_profile_engagement(uuid)": ["authenticated"], // Authenticated profile lookup; exposes aggregate counts and only the caller's like status, never viewer identities.
  "public.set_profile_like(uuid, boolean)": ["authenticated"], // Idempotent own like only, no self likes; bilateral blocks, unique pair and account deletion guards enforced.
  "public.update_profile_interests(jsonb)": ["authenticated"], // Bounded preferences update only auth.uid() after authenticated profile lookup.
  "public.update_profile_widgets(jsonb)": ["authenticated"], // Only auth.uid(); bounded titles, unique categories from live cards, no inventory writes.
  "public.update_profile_appearance(text, text, uuid[], uuid, text)": [
    "authenticated"
  ], // Reuses update_profile checks atomically; banner URL limited to the caller's avatars/banner raster file on the API origin.
  "public.get_profile_privacy()": ["authenticated"], // Reads the current player's privacy setting.
  "public.update_profile_appearance_framed(text, text, uuid[], uuid, text, jsonb)":
    ["authenticated"], // Own bounded crop metadata only; reuses atomic appearance/URL/deletion checks, no inventory or storage grant. Validated with Walid.
  "public.get_public_profile(uuid)": ["authenticated"], // Exposes the permitted public profile projection.
  "public.get_regular_pack_status()": ["authenticated"], // Reads the current player's pack timers.
  "public.get_referral_status()": ["authenticated"], // Reads only auth.uid()'s code, aggregate rewards and bonus balance.
  "public.get_my_referrals(integer, integer)": ["authenticated"], // Own paginated referrals only; blocks/deletion filtered, private booster counts hidden, no Auth metadata or email exposed.
  "public.get_referral_rank()": ["authenticated"], // Only auth.uid()'s verified-referral rank/percentile and aggregate player count; no other player's identity or referral count.
  "public.get_referral_leaderboard(integer, integer, text, boolean)": [
    "authenticated"
  ], // Public active referrers' aggregate verified counts only, max 100 rows. Accepted-friend scope, literal search and bilateral blocks preserve public global ranks; private count only for auth.uid(). No referral relationships, codes or Auth metadata exposed.
  "public.get_collection_leaderboard(integer, integer)": ["authenticated"], // Read-only bounded public collection scores; bans, deletion and bilateral blocks filtered. Private score/breakdown only for auth.uid(), no inventory or Auth metadata exposed.
  "public.get_collection_leaderboard(integer, integer, text, boolean)": [
    "authenticated"
  ], // Same score/visibility guards, max 100 rows; literal username search and accepted friends + self only. Ranks computed globally before filtering; private breakdown only for auth.uid().
  "public.get_shared_card(text)": ["anon", "authenticated"], // Public share token intentionally exposes the shared card projection.
  "public.get_trade_context(uuid)": ["authenticated"], // Reads a permitted trading context for the viewer.
  "public.is_current_user_admin()": ["authenticated"], // RLS helper answers only whether the current player is an admin.
  "public.is_pseudo_available(text)": ["anon", "authenticated"], // Signup intentionally exposes only pseudo availability.
  "public.is_pseudo_required()": ["authenticated"], // Only auth.uid()'s pending OAuth username flag; no other profile data.
  "public.choose_pseudo(text, text)": ["authenticated"], // One-time username of auth.uid()'s own OAuth profile, signup rules, ban and deletion guards; referral attributed like signup.
  "public.keep_decision_pack_card(uuid)": ["authenticated"], // Player keeps their own eligible pack choice.
  "public.list_admin_card_categories()": ["authenticated"], // Admin catalogue access verifies administrator status.
  "public.list_auctions()": ["authenticated"], // Marketplace listing applies viewer visibility rules.
  "public.list_auctions_page(jsonb, integer)": ["authenticated"], // Bounded marketplace pages retain the current viewer's visibility rules.
  "public.list_blocked_users()": ["authenticated"], // Lists only the current player's blocks.
  "public.list_card_shares(integer)": ["authenticated"], // Lists only the current player's shares.
  "public.list_notifications(integer)": ["authenticated"], // Lists only the current player's notifications.
  "public.list_trade_offers()": ["authenticated"], // Lists trades involving the current player.
  "public.list_trade_offers_page(jsonb, integer)": ["authenticated"], // Bounded trade pages only include offers involving auth.uid().
  "public.list_wishlist(text)": ["authenticated"], // Wishlist read applies viewer privacy rules.
  "public.mark_notification_read(uuid)": ["authenticated"], // Player marks only their own notification.
  "public.mark_offline()": ["authenticated"], // Updates the current player's presence.
  "public.move_card_to_folder(uuid, uuid)": ["authenticated"], // Moves an owned card to an owned folder.
  "public.move_cards_to_folder(uuid[], uuid)": ["authenticated"], // Atomically moves the current player's selected cards to an owned folder.
  "public.open_decision_pack()": ["authenticated"], // Opens the current player's available decision pack.
  "public.open_regular_pack()": ["authenticated"], // Opens the current player's available regular pack.
  "public.place_bid(uuid, integer)": ["authenticated"], // Player bids with validated funds and auction state.
  "public.remove_friend(uuid)": ["authenticated"], // Player removes their own friendship.
  "public.report_user(uuid, text, text, uuid, text, boolean)": [
    "authenticated"
  ], // Creates a validated report under the current player's identity.
  "public.get_collection_groups_page(text, text[], text[], boolean, text, boolean, boolean, text, text, integer, integer)":
    ["authenticated"], // Read-only page of the caller's own collection groups (auth.uid()), bounded page size and validated sort.
  "public.get_collection_counts()": ["authenticated"], // Read-only distinct-group counters of the caller's own collection (auth.uid()).
  "public.get_collection_group_copies(text)": ["authenticated"], // Read-only copies of one group of the caller's own collection (auth.uid()), validated key.
  "public.get_collection_owned_copies(uuid[])": ["authenticated"], // Read-only first owned copy per card for at most 100 cards of the caller's own collection.
  "public.get_collection_license_copies(text)": ["authenticated"], // Read-only count of the caller's own copies in one license.
  "public.consume_gif_verification(text)": ["authenticated"], // Ban check first, then the caller's own durable GIF verification quota (20/min, 200/day); returns only a public GIPHY rating.
  "public.report_card(uuid, text)": ["authenticated"], // Creates a validated catalogue-card report under the current player's identity.
  "public.respond_friend_request(uuid, boolean)": ["authenticated"], // Recipient responds to their own request.
  "public.respond_trade_offer(uuid, text)": ["authenticated"], // Trade participant responds with asset validation.
  "public.search_cards(text, integer)": ["authenticated"], // Game catalogue search for signed-in players.
  "public.search_users(text)": ["authenticated"], // Social search exposes permitted profile fields.
  "public.send_auction_chat_message(uuid, text, text)": ["authenticated"], // Eligible participant posts under their own identity.
  "public.send_friend_request(uuid)": ["authenticated"], // Creates a request from the current player.
  "public.set_card_custom_image(uuid, text)": ["authenticated"], // Updates only the current player's card image.
  "public.set_collection_card_locked(uuid, boolean)": ["authenticated"], // Changes lock state only on owned cards.
  "public.set_profile_privacy(boolean)": ["authenticated"], // Changes only the current player's profile privacy.
  "public.toggle_auction_watch(uuid)": ["authenticated"], // Updates only the current player's watch subscription.
  "public.toggle_wishlist(uuid)": ["authenticated"], // Updates only the current player's wishlist.
  "public.touch_presence()": ["authenticated"], // Refreshes only the current player's presence.
  "public.unblock_user(uuid)": ["authenticated"], // Removes only the current player's block.
  "public.update_profile(text, text, uuid[], uuid)": ["authenticated"] // Updates only the current player's profile and owned showcase cards.
};
export default allowlist;
