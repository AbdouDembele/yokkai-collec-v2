-- Read-only application catalogue; no data rows, no function execution.
-- Supabase-managed auth/storage objects are excluded except storage policies and
-- application triggers. Public function owners are compared by exact role name,
-- including SECURITY DEFINER owners; differing migration roles are reported.
select jsonb_build_object('kind', kind, 'name', name, 'value', value)::text
from (
  select 'function' as kind,
    n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as name,
    jsonb_build_object('definition', pg_get_functiondef(p.oid), 'owner', pg_get_userbyid(p.proowner), 'grants',
      (select jsonb_agg(jsonb_build_array(case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        a.privilege_type, a.is_grantable) order by a.grantee=0 desc, pg_get_userbyid(a.grantee), a.privilege_type)
       from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee<>p.proowner)) as value
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind in ('f','p')
  union all
  select 'relation', n.nspname || '.' || c.relname,
    jsonb_build_object('rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'grants',
      (select jsonb_agg(jsonb_build_array(case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        a.privilege_type, a.is_grantable) order by a.grantee=0 desc, pg_get_userbyid(a.grantee), a.privilege_type)
       from aclexplode(coalesce(c.relacl, acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end, c.relowner))) a
       where a.grantee<>c.relowner))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')
  union all
  select 'column', n.nspname || '.' || c.relname || '.' || a.attname,
    jsonb_build_object('position', a.attnum, 'type', format_type(a.atttypid,a.atttypmod),
      'not_null', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated,
      'default', pg_get_expr(d.adbin,d.adrelid))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind in ('r','p','v','m','f') and a.attnum>0 and not a.attisdropped
  union all
  select 'constraint', n.nspname || '.' || c.relname || '.' || con.conname,
    jsonb_build_object('definition', pg_get_constraintdef(con.oid), 'validated', con.convalidated)
  from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
  -- PostgreSQL 18 exposes NOT NULL attributes as pg_constraint rows (contype
  -- 'n'), while older production versions do not. Columns above already carry
  -- attnotnull, so including these rows would create cross-version false drift.
  where n.nspname='public' and con.contype<>'n'
  union all
  select 'index', n.nspname || '.' || c.relname,
    jsonb_build_object('definition', pg_get_indexdef(i.indexrelid), 'valid', i.indisvalid, 'ready', i.indisready)
  from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
  union all
  select 'view', n.nspname || '.' || c.relname, to_jsonb(pg_get_viewdef(c.oid))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('v','m')
  union all
  select 'enum', n.nspname || '.' || t.typname,
    (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)
  from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'
  union all
  select 'sequence', n.nspname || '.' || c.relname,
    jsonb_build_object('type', format_type(s.seqtypid,null), 'start', s.seqstart, 'increment', s.seqincrement,
      'min', s.seqmin, 'max', s.seqmax, 'cache', s.seqcache, 'cycle', s.seqcycle)
  from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
  union all
  select 'column-grant', n.nspname || '.' || c.relname || '.' || col.attname,
    (select jsonb_agg(jsonb_build_array(case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type, a.is_grantable) order by a.grantee=0 desc, pg_get_userbyid(a.grantee), a.privilege_type)
     from aclexplode(col.attacl) a where a.grantee<>c.relowner)
  from pg_attribute col join pg_class c on c.oid=col.attrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and col.attnum>0 and not col.attisdropped and col.attacl is not null
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
    jsonb_build_object('permissive', permissive, 'roles', (select jsonb_agg(r order by r) from unnest(roles) r),
      'cmd', cmd, 'qual', qual, 'with_check', with_check)
  from pg_policies where schemaname in ('public','storage')
  union all
  select 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname,
    jsonb_build_object('definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and (n.nspname='public' or
    (n.nspname in ('auth','storage') and t.tgfoid in
      (select p.oid from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public')))
  union all
  -- The extension is activated separately. A missing cron schema yields no jobs,
  -- while a missing/changed declared job is still detected after its migration.
  select 'cron-job', coalesce(job.jobname, '[unnamed:' || job.jobid || ']') || '@' || job.username,
    jsonb_build_object('schedule', job.schedule, 'command', job.command,
      'username', job.username, 'database', job.database, 'active', job.active)
  from xmltable('/table/row' passing
    case when to_regclass('cron.job') is null then '<table/>'::xml
    else query_to_xml('select jobid,jobname,schedule,command,username,database,active from cron.job', true, false, '') end
    columns jobid bigint path 'jobid', jobname text path 'jobname', schedule text path 'schedule',
      command text path 'command', username text path 'username', database text path 'database', active boolean path 'active'
  ) job
) catalogue order by kind, name;
