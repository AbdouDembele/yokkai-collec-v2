-- Logflare (Supabase analytics) keeps every log event forever with the
-- Postgres backend: 40 days and 20 GB of Auth/Storage logs (IP addresses,
-- e-mails) had accumulated by 2026-11-04. This deletes events older than
-- yokkai.retention_days (default 7, the server log duration announced by the
-- privacy policy) in every _analytics.log_events_* table.
--
-- Run in the _supabase database as the tables' owner (supabase_admin) by
-- ops/yokkai-logflare-retention. Deletes only take row locks: Logflare keeps
-- inserting meanwhile. Autovacuum reuses the freed space for new events.
do $retention$
declare
  days integer := coalesce(nullif(current_setting('yokkai.retention_days', true), ''), '7')::integer;
  cutoff timestamp;
  target record;
  removed bigint;
  total bigint := 0;
begin
  if days < 1 or days > 90 then
    raise exception 'INVALID_RETENTION_DAYS %', days;
  end if;
  -- Logflare stores UTC timestamps without time zone.
  cutoff := (now() at time zone 'utc') - make_interval(days => days);
  for target in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'timestamp' and not a.attisdropped
    where n.nspname = '_analytics' and c.relkind = 'r' and c.relname like 'log\_events\_%'
    order by c.relname
  loop
    execute format('delete from _analytics.%I where "timestamp" < $1', target.relname) using cutoff;
    get diagnostics removed = row_count;
    total := total + removed;
    if removed > 0 then
      raise notice 'logflare_retention table=% removed=%', target.relname, removed;
    end if;
  end loop;
  raise notice 'logflare_retention days=% cutoff=% removed_total=%', days, cutoff, total;
end;
$retention$;
