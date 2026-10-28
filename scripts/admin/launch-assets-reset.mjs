// Operator-only SQL generation. Never a migration, HTTP endpoint or scheduled job.
// The caller supplies a fresh inventory and executes the reviewed transaction
// through an administrator connection after validating a private database backup.
export const launchInventorySQL = `select jsonb_build_object(
  'accounts',(select count(*) from auth.users),
  'accountIds',(select md5(coalesce(string_agg(id::text,',' order by id),'')) from auth.users),
  'profiles',(select count(*) from public.user_profiles),
  'wishlists',(select count(*) from public.wishlists),
  'wishlistDigest',(select md5(coalesce(string_agg(md5(to_jsonb(w)::text),'' order by user_id,card_id),'')) from public.wishlists w),
  'catalogue',(select count(*) from public.cards),
  'catalogueDigest',(select md5(coalesce(string_agg(md5(to_jsonb(c)::text),'' order by id),'')) from public.cards c),
  'cards',(select count(*) from public.user_cards),
  'lockedCards',(select count(*) from public.user_cards where is_locked),
  'karas',(select coalesce(sum(karas_balance),0) from public.user_profiles),
  'activeAuctions',(select count(*) from public.auctions where status='active'),
  'escrowKaras',(select coalesce(sum(current_price),0) from public.auctions where status='active' and buyer_id is not null),
  'pendingTrades',(select count(*) from public.trade_offers where status='pending'),
  'pendingDecisionPacks',(select count(*) from public.decision_packs where status='pending')
) as snapshot`;

const counters = [
  "accounts",
  "profiles",
  "wishlists",
  "catalogue",
  "cards",
  "lockedCards",
  "karas",
  "activeAuctions",
  "escrowKaras",
  "pendingTrades",
  "pendingDecisionPacks"
];
const digests = ["accountIds", "wishlistDigest", "catalogueDigest"];

export function launchAssetsResetSQL(inventory, { commit = false } = {}) {
  if (
    typeof commit !== "boolean" ||
    !inventory ||
    Object.keys(inventory).sort().join() !==
      [...counters, ...digests].sort().join() ||
    counters.some(
      key => !Number.isSafeInteger(inventory[key]) || inventory[key] < 0
    ) ||
    digests.some(key => !/^[a-f0-9]{32}$/.test(inventory[key]))
  )
    throw new Error("A complete fresh launch inventory is required");
  const expected = JSON.stringify(inventory).replaceAll("'", "''");
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='120s';
set local idle_in_transaction_session_timeout='60s';
do $$ begin
  if auth.uid() is not null then raise exception 'OPERATOR_CONNECTION_REQUIRED'; end if;
  if not pg_try_advisory_xact_lock(20261026,1610) then raise exception 'LAUNCH_RESET_ALREADY_RUNNING'; end if;
end $$;
-- Writes and the auction settlement worker cannot cross this boundary. Ordinary
-- reads keep their MVCC view; a blocked writer resumes only after commit/rollback.
lock table auth.users,public.user_profiles,public.user_cards,public.auctions,
  public.trade_offers,public.decision_packs,public.decision_pack_choices,
  public.wishlists,public.cards in share row exclusive mode;
create temporary table launch_reset_before on commit drop as ${launchInventorySQL};
do $$ begin
  if (select snapshot from launch_reset_before) is distinct from '${expected}'::jsonb
    then raise exception 'LAUNCH_RESET_INVENTORY_CHANGED'; end if;
end $$;
-- Full account rows stay private in the database; only their fingerprint is used.
create temporary table launch_reset_auth on commit drop as
  select md5(coalesce(string_agg(md5(to_jsonb(u)::text),'' order by id),'')) digest from auth.users u;
create temporary table launch_reset_profiles on commit drop as
  select user_id,to_jsonb(p) || jsonb_build_object('karas_balance',0,'featured_card_ids','[]'::jsonb)
    || case when banner_card_id is not null then jsonb_build_object(
      'banner_card_id',null,'banner_url',null,'banner_frame',null,'banner_frame_source',null)
      else '{}'::jsonb end expected
  from public.user_profiles p;

-- Active auction escrows are part of the requested Karas reset. Do not refund
-- them after zeroing balances. Closed historical sales and bids remain intact.
delete from public.auctions where status='active';
update public.trade_offers set status='cancelled',updated_at=clock_timestamp() where status='pending';
-- Previously opened choices could otherwise recreate old cards or sell for Karas.
-- Keep claimed history, unopened booster reserves and their schedules unchanged.
delete from public.decision_packs where status='pending';
-- Some old profiles already reference a card they no longer own. Clear those
-- stale selections too: their last-copy trigger cannot run during this reset.
update public.user_profiles set banner_card_id=null,banner_url=null,
  banner_frame=null,banner_frame_source=null where banner_card_id is not null;
update public.user_cards set is_locked=false where is_locked;
delete from public.user_cards;
update public.user_profiles set karas_balance=0,featured_card_ids='{}'::uuid[];
-- Run the existing last-owned-copy banner cleanup before checking preservation.
set constraints all immediate;

create temporary table launch_reset_after on commit drop as ${launchInventorySQL};
do $$ declare before_state jsonb; after_state jsonb;
begin
  select snapshot into before_state from launch_reset_before;
  select snapshot into after_state from launch_reset_after;
  if (select md5(coalesce(string_agg(md5(to_jsonb(u)::text),'' order by id),'')) from auth.users u)
      is distinct from (select digest from launch_reset_auth) then raise exception 'LAUNCH_RESET_ACCOUNTS_CHANGED'; end if;
  if exists(select 1 from launch_reset_profiles saved full join public.user_profiles p using(user_id)
      where to_jsonb(p) is distinct from saved.expected) then raise exception 'LAUNCH_RESET_PROFILE_CHANGED'; end if;
  if after_state - array['cards','lockedCards','karas','activeAuctions','escrowKaras','pendingTrades','pendingDecisionPacks']
      is distinct from before_state - array['cards','lockedCards','karas','activeAuctions','escrowKaras','pendingTrades','pendingDecisionPacks']
      then raise exception 'LAUNCH_RESET_PROTECTED_DATA_CHANGED'; end if;
  if (after_state->>'cards')::bigint<>0 or (after_state->>'karas')::bigint<>0
      or exists(select 1 from public.user_profiles where karas_balance<>0)
      or (after_state->>'activeAuctions')::bigint<>0 or (after_state->>'pendingTrades')::bigint<>0
      or (after_state->>'pendingDecisionPacks')::bigint<>0 then raise exception 'LAUNCH_RESET_INCOMPLETE'; end if;
end $$;
select jsonb_build_object('before',b.snapshot,'after',a.snapshot,'committed',${commit})
  from launch_reset_before b cross join launch_reset_after a;
${commit ? "commit" : "rollback"};
`;
}
