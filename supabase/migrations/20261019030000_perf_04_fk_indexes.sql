begin;
set local lock_timeout = '3s';

-- PERF-04: unconditional indexes also cover historical rows during FK checks.
-- Auth deletion cascades through billing_accounts into webhook history.
create index if not exists billing_webhook_events_account_id_idx
  on public.billing_webhook_events(account_id);
-- Account deletion/export includes claimed packs, not just the pending pack.
create index if not exists decision_packs_user_id_idx
  on public.decision_packs(user_id);
-- Card destruction sets the reference to NULL even for finished auctions.
create index if not exists auctions_card_instance_id_idx
  on public.auctions(card_instance_id);

-- admin_delete_card_core and bulk preview/delete look up catalogue references.
create index if not exists card_shares_card_id_idx
  on public.card_shares(card_id);
create index if not exists decision_pack_choices_card_id_idx
  on public.decision_pack_choices(card_id);
create index if not exists user_profiles_banner_card_id_idx
  on public.user_profiles(banner_card_id);
-- The same RPC clears kept choices without knowing the pack id. The id PK
-- already covers the composite FK; only this reverse lookup needs an index.
create index if not exists decision_packs_kept_choice_id_idx
  on public.decision_packs(kept_choice_id);
-- delete_folder and its composite FK check filter by owner AND folder.
create index if not exists user_cards_user_folder_idx
  on public.user_cards(user_id, folder_id);

-- No additional composite index for decision_packs(id,kept_choice_id):
-- the id primary key finds at most one referencing row for the FK check.
-- No additional indexes for the four remaining audited FKs:
-- admin_users.granted_by: small administrative allowlist; deletion clears it,
-- but player traffic never searches grants by grantor.
-- notifications.achievement_id and user_achievements.achievement_id: the
-- achievement catalogue is seeded, not deleted by any application path;
-- player RPCs use user_id-leading indexes (including the achievement PK).
-- trade_offers.parent_offer_id: counteroffers look up the parent by its PK;
-- account deletion anonymizes and retains offers rather than deleting parents.

commit;
