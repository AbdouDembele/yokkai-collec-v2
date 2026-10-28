begin;

create table public.card_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  reason text not null check (reason in ('image_issue','wrong_license','duplicate_card')),
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  constraint card_reports_reporter_card_reason_key unique (reporter_id,card_id,reason)
);

create index card_reports_status_created_idx on public.card_reports(status,created_at desc);
create index card_reports_card_idx on public.card_reports(card_id,created_at desc);
alter table public.card_reports enable row level security;
revoke all on table public.card_reports from public,anon,authenticated;
grant all on table public.card_reports to service_role;

create function public.report_card(p_card_id uuid,p_reason text)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare
  current_user_id uuid:=auth.uid();
  target public.cards%rowtype;
  report_id uuid;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_reason is null or p_reason not in ('image_issue','wrong_license','duplicate_card') then
    raise exception 'REPORT_INVALID' using errcode='P0001';
  end if;
  if (select count(*) from public.card_reports where reporter_id=current_user_id and created_at>=now()-interval '24 hours')>=10 then
    raise exception 'REPORT_LIMIT' using errcode='P0001';
  end if;
  select * into target from public.cards where id=p_card_id;
  if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  insert into public.card_reports(reporter_id,card_id,reason,snapshot)
  values(current_user_id,target.id,p_reason,jsonb_build_object(
    'name',target.nom,'category',target.categorie,'franchise',target.franchise,
    'rarity',target.rarete_base,'imageUrl',target.image_url
  )) returning id into report_id;
  return report_id;
exception when unique_violation then
  raise exception 'REPORT_DUPLICATE' using errcode='P0001';
end; $$;

create function public.admin_search_card_reports(p_status text default null,p_query text default '',p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  query text:=left(btrim(coalesce(p_query,'')),100);
  safe_limit integer:=least(greatest(coalesce(p_limit,100),1),100);
  safe_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is not null and p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  return (
    with matching as (
      select r.*,coalesce(reporter.pseudo,split_part(coalesce(reporter_auth.email,'Joueur'),'@',1),'Joueur') reporter_pseudo,
        coalesce(reporter_auth.email,'') reporter_email,c.nom card_name,c.franchise,c.image_url,c.rarete_base
      from public.card_reports r
      join auth.users reporter_auth on reporter_auth.id=r.reporter_id
      left join public.user_profiles reporter on reporter.user_id=r.reporter_id
      left join public.cards c on c.id=r.card_id
      where (p_status is null or r.status=p_status) and (query='' or
        reporter.pseudo ilike '%'||query||'%' or reporter_auth.email ilike '%'||query||'%' or
        c.nom ilike '%'||query||'%' or c.franchise ilike '%'||query||'%')
    ), page as (
      select * from matching order by created_at desc,id desc limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'total',(select count(*) from matching),
      'reports',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'reporterId',reporter_id,'reporterPseudo',reporter_pseudo,'reporterEmail',reporter_email,
        'cardId',card_id,'cardName',coalesce(card_name,snapshot->>'name','Carte supprimée'),
        'franchise',coalesce(franchise,snapshot->>'franchise',''),'imageUrl',coalesce(image_url,snapshot->>'imageUrl',''),
        'rarity',coalesce(rarete_base::text,snapshot->>'rarity',''),'reason',reason,'snapshot',snapshot,
        'status',status,'createdAt',created_at
      ) order by created_at desc,id desc) from page),'[]'::jsonb)
    )
  );
end; $$;

alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check (action in (
  'card.create','card.update','card.delete','card.import',
  'player.ban','player.unban','player.card.remove','report.status.change','card_report.status.change'
));

create function public.admin_set_card_report_status(p_report_id uuid,p_status text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare
  previous_status text;
  target_card_id uuid;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is null or p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  select status,card_id into previous_status,target_card_id from public.card_reports where id=p_report_id for update;
  if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  if previous_status<>p_status then
    update public.card_reports set status=p_status where id=p_report_id;
    insert into public.admin_audit_logs(admin_user_id,action,card_id,metadata)
    values(auth.uid(),'card_report.status.change',target_card_id,jsonb_build_object(
      'report_id',p_report_id,'previous_status',previous_status,'new_status',p_status
    ));
  end if;
  return true;
end; $$;

revoke all on function public.report_card(uuid,text),public.admin_search_card_reports(text,text,integer,integer),public.admin_set_card_report_status(uuid,text) from public,anon,authenticated;
grant execute on function public.report_card(uuid,text),public.admin_search_card_reports(text,text,integer,integer),public.admin_set_card_report_status(uuid,text) to authenticated;

commit;
