begin;

-- Trusted server only. No Stripe identifier, lease or subscription mutation is exposed to players.
create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  scope text not null check (scope ~ '^(test|live):acct_[A-Za-z0-9]+:price_[A-Za-z0-9]+$'),
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  checkout_id text unique check (checkout_id ~ '^cs_(test_|live_)?[A-Za-z0-9]+$'),
  checkout_nonce uuid not null default gen_random_uuid(),
  customer_started_at timestamptz,
  checkout_started_at timestamptz,
  active boolean not null default false,
  status text not null default 'not_subscribed' check (status in ('not_subscribed', 'active', 'trialing', 'incomplete', 'incomplete_expired', 'past_due', 'canceled', 'unpaid', 'paused')),
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  risk_hold boolean not null default false,
  verified_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now()
);
create table public.billing_webhook_events (
  scope text not null,
  event_id text not null check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  processed_at timestamptz not null default now(),
  primary key (scope, event_id)
);
alter table public.billing_accounts enable row level security;
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_accounts, public.billing_webhook_events from public, anon, authenticated;
grant select, insert, update, delete on public.billing_accounts, public.billing_webhook_events to service_role;

-- A fenced lease spans provider requests across server processes. Late workers cannot commit.
create function public.billing_claim(p_user uuid, p_scope text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare a public.billing_accounts;
begin
  insert into public.billing_accounts(user_id, scope) values (p_user, p_scope) on conflict (user_id) do nothing;
  update public.billing_accounts set lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '90 seconds'
  where user_id = p_user and scope = p_scope and (lease_until is null or lease_until < clock_timestamp()) returning * into a;
  if a.id is null then raise exception 'BILLING_BUSY'; end if;
  return to_jsonb(a);
end;
$$;

create function public.billing_release(p_id uuid, p_token uuid) returns void
language sql security invoker set search_path = '' as $$
  update public.billing_accounts set lease_token = null, lease_until = null where id = p_id and lease_token = p_token;
$$;

create function public.billing_save(p_id uuid, p_token uuid, p_customer text, p_checkout text, p_rotate boolean, p_state jsonb, p_event text, p_hold boolean, p_prepare_customer boolean, p_prepare_checkout boolean) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare a public.billing_accounts;
begin
  select * into a from public.billing_accounts where id = p_id and lease_token = p_token and lease_until > clock_timestamp() for update;
  if a.id is null then raise exception 'BILLING_LEASE_LOST'; end if;
  if p_customer is not null and a.stripe_customer_id is not null and a.stripe_customer_id <> p_customer then raise exception 'BILLING_CUSTOMER_MISMATCH'; end if;
  if p_state is not null and (jsonb_typeof(p_state) <> 'object' or not (p_state ?& array['active','status','endsAt','cancelAtPeriodEnd']) or
    jsonb_typeof(p_state->'active') <> 'boolean' or jsonb_typeof(p_state->'cancelAtPeriodEnd') <> 'boolean' or jsonb_typeof(p_state->'status') <> 'string') then
    raise exception 'BILLING_INVALID_STATE';
  end if;
  update public.billing_accounts set
    stripe_customer_id = coalesce(p_customer, stripe_customer_id),
    checkout_id = case when p_rotate then null else coalesce(p_checkout, checkout_id) end,
    checkout_nonce = case when p_rotate then gen_random_uuid() else checkout_nonce end,
    customer_started_at = case when p_prepare_customer then coalesce(customer_started_at, clock_timestamp()) else customer_started_at end,
    checkout_started_at = case when p_rotate then null when p_prepare_checkout then coalesce(checkout_started_at, clock_timestamp()) else checkout_started_at end,
    risk_hold = risk_hold or p_hold,
    active = case when risk_hold or p_hold then false when p_state is not null then (p_state->>'active')::boolean else active end,
    status = case when p_state is not null then p_state->>'status' else status end,
    period_end = case when p_state is not null then to_timestamp((p_state->>'endsAt')::double precision) else period_end end,
    cancel_at_period_end = case when p_state is not null then (p_state->>'cancelAtPeriodEnd')::boolean else cancel_at_period_end end,
    verified_at = case when p_state is not null then clock_timestamp() else verified_at end
  where id = a.id returning checkout_nonce into a.checkout_nonce;
  if p_event is not null then
    insert into public.billing_webhook_events(scope,event_id,account_id) values(a.scope,p_event,a.id) on conflict do nothing;
  end if;
  return a.checkout_nonce;
end;
$$;

-- Internal entitlement predicate for the next game-RPC integration. Never trusts a browser flag.
-- Fail closed on expiration, payment failure, paused collection, risk hold or stale provider state.
create function public.billing_has_pro(p_user uuid, p_scope text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.billing_accounts where user_id = p_user and scope = p_scope and active and status = 'active' and not risk_hold
    and period_end > now() and verified_at > now() - interval '15 minutes');
$$;

revoke all on function public.billing_claim(uuid,text), public.billing_release(uuid,uuid), public.billing_save(uuid,uuid,text,text,boolean,jsonb,text,boolean,boolean,boolean), public.billing_has_pro(uuid,text) from public, anon, authenticated;
grant execute on function public.billing_claim(uuid,text), public.billing_release(uuid,uuid), public.billing_save(uuid,uuid,text,text,boolean,jsonb,text,boolean,boolean,boolean), public.billing_has_pro(uuid,text) to service_role;
commit;
