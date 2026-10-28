begin;

-- Shared across application instances. Players cannot choose or reset a quota.
create table public.billing_request_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope ~ '^(test|live):acct_[A-Za-z0-9]+:price_[A-Za-z0-9]+$'),
  action text not null check (action in ('checkout', 'portal', 'status')),
  window_started_at timestamptz not null,
  requests integer not null check (requests between 1 and 30),
  primary key (user_id, scope, action)
);
alter table public.billing_request_limits enable row level security;
revoke all on public.billing_request_limits from public, anon, authenticated;
grant select, insert, update, delete on public.billing_request_limits to service_role;

-- Return zero when admitted, otherwise the number of seconds until retry.
-- ON CONFLICT locks the same row: simultaneous workers cannot exceed the cap.
create function public.billing_consume_request(p_user uuid, p_scope text, p_action text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  stamp timestamptz := clock_timestamp();
  window_size interval;
  request_limit integer;
  admitted boolean;
  started timestamptz;
begin
  case p_action
    when 'checkout' then window_size := interval '10 minutes'; request_limit := 10;
    when 'portal' then window_size := interval '5 minutes'; request_limit := 10;
    when 'status' then window_size := interval '1 minute'; request_limit := 30;
    else raise exception 'BILLING_INVALID_REQUEST';
  end case;
  insert into public.billing_request_limits(user_id, scope, action, window_started_at, requests)
    values(p_user, p_scope, p_action, stamp, 1)
  on conflict (user_id, scope, action) do update set
    window_started_at = case when billing_request_limits.window_started_at + window_size <= stamp
      then stamp else billing_request_limits.window_started_at end,
    requests = case when billing_request_limits.window_started_at + window_size <= stamp
      then 1 else billing_request_limits.requests + 1 end
  where billing_request_limits.window_started_at + window_size <= stamp
    or billing_request_limits.requests < request_limit
  returning true into admitted;
  if admitted is true then return 0; end if;
  select window_started_at into strict started from public.billing_request_limits
    where user_id = p_user and scope = p_scope and action = p_action;
  return greatest(1, ceil(extract(epoch from started + window_size - stamp))::integer);
end;
$$;
revoke all on function public.billing_consume_request(uuid,text,text) from public, anon, authenticated;
grant execute on function public.billing_consume_request(uuid,text,text) to service_role;
commit;
