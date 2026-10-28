begin;

-- This helper bypasses billing cancellation. Only its owner, through the
-- SECURITY DEFINER prepare_account_deletion wrapper, needs EXECUTE.
revoke execute on function public.prepare_account_deletion_without_billing(uuid)
  from public, anon, authenticated, service_role;
do $$
declare function_owner name;
begin
  select pg_get_userbyid(proowner) into strict function_owner
  from pg_proc
  where oid = 'public.prepare_account_deletion_without_billing(uuid)'::regprocedure;
  execute format(
    'grant execute on function public.prepare_account_deletion_without_billing(uuid) to %I',
    function_owner
  );
end;
$$;

commit;
