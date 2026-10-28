begin;

-- Explicit operator grants are independent from Stripe and stay server-only.
-- They are intended for staff testing, demonstrations and support cases, with
-- an auditable reason and an optional expiry.
create table public.pro_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 240),
  expires_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.pro_access_grants enable row level security;
revoke all on public.pro_access_grants from public,anon,authenticated;
grant select,insert,update,delete on public.pro_access_grants to service_role;

-- A manual grant activates the exact same server-side entitlement predicate as
-- a verified payment. Deleted accounts remain ineligible in every case.
create or replace function public.billing_has_game_pro(p_user uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select not exists (
    select 1 from public.account_deletion_log where user_id=p_user
  ) and (
    exists (
      select 1 from public.pro_access_grants g
      where g.user_id=p_user
        and (g.expires_at is null or g.expires_at>clock_timestamp())
    )
    or exists (
      select 1
      from public.billing_entitlement_config c
      join public.billing_accounts a on a.scope=c.scope and a.user_id=p_user
      where c.singleton and c.enabled and a.active and a.status='active'
        and not a.risk_hold and a.period_end>clock_timestamp()
        and a.verified_at>clock_timestamp()-interval '15 minutes'
        and a.verified_at<=clock_timestamp()
    )
  );
$$;
revoke all on function public.billing_has_game_pro(uuid) from public,anon,authenticated;
grant execute on function public.billing_has_game_pro(uuid) to service_role;

create function public.billing_sync_manual_pro_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.billing_sync_pack_timing(coalesce(new.user_id,old.user_id));
  return null;
end;
$$;
revoke all on function public.billing_sync_manual_pro_access() from public,anon,authenticated;
create trigger billing_sync_manual_pro_access
  after insert or update of expires_at or delete on public.pro_access_grants
  for each row execute function public.billing_sync_manual_pro_access();

create function public.billing_set_manual_pro_access(
  p_user uuid,
  p_enabled boolean,
  p_reason text default null,
  p_expires_at timestamptz default null,
  p_granted_by uuid default null
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_user is null or p_enabled is null then
    raise exception 'PRO_GRANT_INVALID';
  end if;
  if p_granted_by is not null and not exists (
    select 1 from public.admin_users where user_id=p_granted_by
  ) then
    raise exception 'PRO_GRANT_FORBIDDEN';
  end if;
  if p_enabled then
    if p_reason is null or char_length(btrim(p_reason)) not between 3 and 240
      or (p_expires_at is not null and p_expires_at<=clock_timestamp()) then
      raise exception 'PRO_GRANT_INVALID';
    end if;
    insert into public.pro_access_grants(user_id,reason,expires_at,granted_by)
      values(p_user,btrim(p_reason),p_expires_at,p_granted_by)
    on conflict(user_id) do update set
      reason=excluded.reason,
      expires_at=excluded.expires_at,
      granted_by=excluded.granted_by,
      updated_at=clock_timestamp();
  else
    delete from public.pro_access_grants where user_id=p_user;
  end if;
end;
$$;
revoke all on function public.billing_set_manual_pro_access(uuid,boolean,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.billing_set_manual_pro_access(uuid,boolean,text,timestamptz,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
