begin;

-- Production monitor snapshots written every 5 minutes by the host script
-- /usr/local/sbin/yokkai-monitor (ops/monitor), as the postgres owner. The
-- payload holds infrastructure metrics only: no account, address or secret.
-- No player or service role can read the table; administrators go through
-- public.admin_get_ops_monitor below. The writer keeps 14 days of history.
create table public.ops_monitor_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default clock_timestamp(),
  worst smallint not null check (worst between 0 and 2),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);

create index ops_monitor_snapshots_captured_at_idx
  on public.ops_monitor_snapshots (captured_at desc);

alter table public.ops_monitor_snapshots enable row level security;
revoke all on table public.ops_monitor_snapshots from public, anon, authenticated, service_role;
revoke all on sequence public.ops_monitor_snapshots_id_seq from public, anon, authenticated, service_role;

create or replace function public.admin_get_ops_monitor(p_hours integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_hours integer := least(greatest(coalesce(p_hours, 24), 1), 168);
begin
  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'now', clock_timestamp(),
    'latest', (
      select jsonb_build_object(
        'capturedAt', s.captured_at,
        'worst', s.worst,
        'payload', s.payload
      )
      from public.ops_monitor_snapshots s
      order by s.captured_at desc
      limit 1
    ),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', h.captured_at,
        'worst', h.worst,
        'load5', h.payload #> '{host,load5}',
        'cpus', h.payload #> '{host,cpus}',
        'memTotal', h.payload #> '{host,memTotal}',
        'memAvailable', h.payload #> '{host,memAvailable}',
        'diskTotal', h.payload #> '{host,diskTotal}',
        'diskFree', h.payload #> '{host,diskFree}',
        'connUsed', h.payload #> '{db,connUsed}',
        'connMax', h.payload #> '{db,connMax}'
      ) order by h.captured_at)
      from public.ops_monitor_snapshots h
      where h.captured_at > clock_timestamp() - make_interval(hours => safe_hours)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_ops_monitor(integer) from public, anon, authenticated;
grant execute on function public.admin_get_ops_monitor(integer) to authenticated;

commit;
