begin;

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null
    or to_regclass('cron.job_run_details') is null then
    raise exception 'PG_CRON_HISTORY_REQUIRED: run scripts/admin/enable-pg-cron.sh before this migration';
  end if;
  if current_user <> 'postgres' then
    raise exception 'This migration must run as postgres';
  end if;
  if not has_table_privilege(current_user,'cron.job_run_details','SELECT')
    or not has_table_privilege(current_user,'cron.job_run_details','DELETE') then
    raise exception 'postgres needs SELECT and DELETE on cron.job_run_details to purge cron history';
  end if;
end;
$$;

-- Named scheduling replaces the existing job; NULL end_time keeps running jobs.
select cron.schedule('purge-cron-history', '0 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days';$$);

commit;
