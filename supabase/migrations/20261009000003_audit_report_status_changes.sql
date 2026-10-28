begin;

alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check (action in (
  'card.create','card.update','card.delete','card.import',
  'player.ban','player.unban','player.card.remove','report.status.change'
));

create or replace function public.admin_set_report_status(p_report_id uuid,p_status text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare
  previous_status text;
  target_user_id uuid;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is null or p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;

  select status,reported_id into previous_status,target_user_id
  from public.user_reports
  where id=p_report_id
  for update;
  if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;

  if previous_status<>p_status then
    update public.user_reports set status=p_status where id=p_report_id;
    insert into public.admin_audit_logs(admin_user_id,action,metadata)
    values(auth.uid(),'report.status.change',jsonb_build_object(
      'report_id',p_report_id,
      'target_user_id',target_user_id,
      'previous_status',previous_status,
      'new_status',p_status
    ));
  end if;
  return true;
end; $$;

revoke all on function public.admin_set_report_status(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_set_report_status(uuid,text) to authenticated;

commit;
