-- Run only after migration 20261105230000, with a verified backup.
-- Unique user receipt makes retries safe, including after packs were opened.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(710031,1105);
with credited as (
 insert into public.maintenance_pack_grants(user_id,campaign)
 select p.user_id,'maintenance-2026-11-05' from public.user_profiles p
 join auth.users u on u.id=p.user_id
 where not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
 -- Freeze the maintenance cohort: retries must not credit newly registered accounts.
 and coalesce((to_jsonb(u)->>'created_at')::timestamptz,'-infinity') <= timestamptz '2026-11-05 22:31:38+00'
 and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=clock_timestamp()
 on conflict(user_id) do nothing returning user_id
), updated as (
 update public.user_profiles p set bonus_regular_packs=p.bonus_regular_packs+25
 from credited c where p.user_id=c.user_id returning p.user_id
)
select jsonb_build_object('creditedAccounts',count(*),'regularPacks',count(*)*25,'decisionPacks',count(*)) from updated;
commit;
