begin;

set local lock_timeout = '5s';
set local statement_timeout = '10s';

-- Preparation only: no account is deleted and no deletion RPC is exposed here.
alter table public.auctions
  alter column seller_id drop not null,
  drop constraint auctions_seller_id_fkey,
  add constraint auctions_seller_id_fkey foreign key (seller_id) references auth.users(id) on delete set null,
  drop constraint auctions_buyer_id_fkey,
  add constraint auctions_buyer_id_fkey foreign key (buyer_id) references auth.users(id) on delete set null;

alter table public.bids
  alter column bidder_id drop not null,
  drop constraint bids_bidder_id_fkey,
  add constraint bids_bidder_id_fkey foreign key (bidder_id) references auth.users(id) on delete set null;

alter table public.trade_offers
  alter column from_user drop not null,
  alter column to_user drop not null,
  drop constraint trade_offers_from_user_fkey,
  add constraint trade_offers_from_user_fkey foreign key (from_user) references auth.users(id) on delete set null,
  drop constraint trade_offers_to_user_fkey,
  add constraint trade_offers_to_user_fkey foreign key (to_user) references auth.users(id) on delete set null;

alter table public.user_reports
  alter column reporter_id drop not null,
  alter column reported_id drop not null,
  drop constraint user_reports_reporter_id_fkey,
  add constraint user_reports_reporter_id_fkey foreign key (reporter_id) references auth.users(id) on delete set null,
  drop constraint user_reports_reported_id_fkey,
  add constraint user_reports_reported_id_fkey foreign key (reported_id) references auth.users(id) on delete set null,
  -- Live users remain unique; detached reports must not collide on NULL identities.
  drop constraint user_reports_reporter_id_reported_id_context_type_context_i_key;
create unique index user_reports_live_identity_unique
  on public.user_reports (reporter_id, reported_id, context_type, context_id)
  nulls not distinct
  where reporter_id is not null and reported_id is not null;

alter table public.card_reports
  alter column reporter_id drop not null,
  drop constraint card_reports_reporter_id_fkey,
  add constraint card_reports_reporter_id_fkey foreign key (reporter_id) references auth.users(id) on delete set null;

alter table public.admin_audit_logs
  alter column admin_user_id drop not null,
  drop constraint admin_audit_logs_admin_user_id_fkey,
  add constraint admin_audit_logs_admin_user_id_fkey foreign key (admin_user_id) references auth.users(id) on delete set null;

-- Deliberately no FK: this tombstone must survive deletion of the Auth identity.
-- It remains personal data, restricted to the trusted restoration/deletion service.
create table public.account_deletion_log (
  user_id uuid primary key,
  deleted_at timestamptz not null default clock_timestamp()
);
alter table public.account_deletion_log enable row level security;
revoke all on table public.account_deletion_log from public, anon, authenticated;
grant all on table public.account_deletion_log to service_role;

commit;
