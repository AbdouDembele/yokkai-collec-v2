begin;

-- Private operator journal. Deliberately no cascading FK: deleting an account
-- must not erase the administrative receipt or its evidence.
create table public.account_sanctions (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null unique check(length(operation_id) between 16 and 200),
  user_id uuid not null,
  sanction_type text not null check(sanction_type in ('AFFILIATE_ABUSE_SANCTION','AFFILIATE_ABUSE_WARNING_WITH_PENALTY','AFFILIATE_ABUSE_WARNING')),
  reason text not null check(reason='AFFILIATE_ABUSE'),
  card_action text not null check(card_action in ('NONE','PROVEN_ASSET_REMOVAL')),
  kara_action text not null check(kara_action in ('NONE','ADMIN_DISCIPLINARY_PENALTY')),
  cards_removed integer not null check(cards_removed>=0),
  kara_removed integer not null check(kara_removed>=0),
  kara_balance_before integer not null check(kara_balance_before>=0),
  kara_balance_after integer not null check(kara_balance_after>=0),
  created_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz not null,
  published_at timestamptz,
  notification_seen_at timestamptz,
  status text not null check(status in ('APPLIED','ROLLED_BACK')),
  metadata jsonb not null default '{}',
  check(kara_balance_before-kara_removed=kara_balance_after),
  check((kara_action='NONE' and kara_removed=0) or (kara_action='ADMIN_DISCIPLINARY_PENALTY' and kara_removed=kara_balance_before/2)),
  check(card_action<>'NONE' or cards_removed=0),
  check((sanction_type='AFFILIATE_ABUSE_SANCTION' and card_action='PROVEN_ASSET_REMOVAL' and kara_action='ADMIN_DISCIPLINARY_PENALTY')
    or (sanction_type='AFFILIATE_ABUSE_WARNING_WITH_PENALTY' and card_action='NONE' and kara_action='ADMIN_DISCIPLINARY_PENALTY')
    or (sanction_type='AFFILIATE_ABUSE_WARNING' and card_action='NONE' and kara_action='NONE')),
  check(notification_seen_at is null or published_at is not null)
);
alter table public.account_sanctions enable row level security;
revoke all on public.account_sanctions from public,anon,authenticated,service_role;
create index account_sanctions_pending on public.account_sanctions(user_id,applied_at,id)
  where status='APPLIED' and published_at is not null and notification_seen_at is null;

create function public.get_my_pending_sanctions()
returns table(sanction_id uuid,sanction_type text,cards_removed integer,kara_removed integer,applied_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return query select s.id,s.sanction_type,s.cards_removed,s.kara_removed,s.applied_at
    from public.account_sanctions s where s.user_id=auth.uid() and s.status='APPLIED'
      and s.published_at is not null and s.notification_seen_at is null
    order by s.applied_at,s.id limit 20;
end; $$;
revoke all on function public.get_my_pending_sanctions() from public,anon,authenticated,service_role;
grant execute on function public.get_my_pending_sanctions() to authenticated;

create function public.acknowledge_my_sanction(p_sanction_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_player_not_banned();
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.account_sanctions set notification_seen_at=coalesce(notification_seen_at,clock_timestamp())
    where id=p_sanction_id and user_id=auth.uid() and status='APPLIED' and published_at is not null;
  return found;
end; $$;
revoke all on function public.acknowledge_my_sanction(uuid) from public,anon,authenticated,service_role;
grant execute on function public.acknowledge_my_sanction(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
