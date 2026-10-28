begin;

create function public.admin_search_reports(p_status text default null,p_query text default '',p_limit integer default 30,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  query text:=left(btrim(coalesce(p_query,'')),100);
  safe_limit integer:=least(greatest(coalesce(p_limit,30),1),100);
  safe_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is not null and p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  return (
    with matching as (
      select r.*,coalesce(reporter.pseudo,split_part(coalesce(reporter_auth.email,'Joueur'),'@',1),'Joueur') reporter_pseudo,
        coalesce(reporter_auth.email,'') reporter_email,
        coalesce(reported.pseudo,split_part(coalesce(reported_auth.email,'Joueur'),'@',1),'Joueur') reported_pseudo,
        coalesce(reported_auth.email,'') reported_email,
        reported_auth.banned_until is not null and reported_auth.banned_until>now() reported_is_banned
      from public.user_reports r
      join auth.users reporter_auth on reporter_auth.id=r.reporter_id
      join auth.users reported_auth on reported_auth.id=r.reported_id
      left join public.user_profiles reporter on reporter.user_id=r.reporter_id
      left join public.user_profiles reported on reported.user_id=r.reported_id
      where (p_status is null or r.status=p_status) and (query='' or
        reporter.pseudo ilike '%'||query||'%' or reporter_auth.email ilike '%'||query||'%' or
        reported.pseudo ilike '%'||query||'%' or reported_auth.email ilike '%'||query||'%')
    ), page as (
      select * from matching order by created_at desc,id desc limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'total',(select count(*) from matching),
      'reports',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'reporterId',reporter_id,'reporterPseudo',reporter_pseudo,'reporterEmail',reporter_email,
        'reportedId',reported_id,'reportedPseudo',reported_pseudo,'reportedEmail',reported_email,'reportedIsBanned',reported_is_banned,
        'reason',reason,'contextType',context_type,'contextId',context_id,'snapshot',snapshot,'details',details,'status',status,'createdAt',created_at
      ) order by created_at desc,id desc) from page),'[]'::jsonb)
    )
  );
end; $$;

revoke all on function public.admin_search_reports(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_search_reports(text,text,integer,integer) to authenticated;

commit;
