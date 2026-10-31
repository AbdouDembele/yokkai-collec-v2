begin;

-- Only the active bit is public. Operator evidence remains owner-only.
create table public.economic_maintenance_state (
  singleton boolean primary key default true check(singleton),
  active boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  version text,
  operator text,
  reason text
);
insert into public.economic_maintenance_state(singleton) values(true);
alter table public.economic_maintenance_state enable row level security;
revoke all on public.economic_maintenance_state from public,anon,authenticated,service_role;
grant select(active) on public.economic_maintenance_state to anon,authenticated,service_role;
create policy economic_maintenance_read_active on public.economic_maintenance_state
  for select to anon,authenticated,service_role using(true);

-- Invoker trigger: grants are checked at installation, not during execution.
-- No new SECURITY DEFINER/RPC or player administration privilege is needed.
create function public.guard_economic_maintenance() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  -- A request-supplied GUC alone cannot bypass the gate. SECURITY DEFINER
  -- callers still have session_user=authenticator, unlike the operator socket.
  if session_user='postgres' and current_setting('yokkai.economic_operator',true)='on' then
    return null;
  end if;
  -- Try, never queue: exclusive operator admission also fences old snapshots.
  if not pg_try_advisory_xact_lock_shared(710031,2100) then
    raise exception 'ECONOMIC_MAINTENANCE' using errcode='P0001';
  end if;
  if coalesce((select active from public.economic_maintenance_state),true) then
    raise exception 'ECONOMIC_MAINTENANCE' using errcode='P0001';
  end if;
  return null;
end;$$;
revoke all on function public.guard_economic_maintenance() from public,anon,authenticated,service_role;

do $$declare relation text;begin
  foreach relation in array array['user_cards','auctions','bids','trade_offers','decision_packs','decision_pack_choices'] loop
    execute format('create trigger economic_maintenance before insert or update or delete or truncate on public.%I for each statement execute function public.guard_economic_maintenance()',relation);
  end loop;
end;$$;
create trigger economic_maintenance_balance before update of karas_balance,
  bonus_regular_packs,next_regular_pack_at,next_decision_pack_at,
  regular_pack_interval_seconds,decision_pack_interval_seconds
  on public.user_profiles for each statement execute function public.guard_economic_maintenance();
create trigger economic_maintenance_profile_lifecycle before insert or delete or truncate
  on public.user_profiles for each statement execute function public.guard_economic_maintenance();

commit;
