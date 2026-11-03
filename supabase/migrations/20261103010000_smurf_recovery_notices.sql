begin;

-- Only the affected player's committed quantities are exposed. Internal notes,
-- source identities and economic evidence stay in the private source receipts.
create table public.anticheat_asset_recovery_notices (
  id uuid primary key default gen_random_uuid(),
  receipt_kind text not null check(receipt_kind in('active','deleted','deleted_accounts')),
  receipt_id uuid not null,
  user_id uuid not null,
  cards_removed integer not null check(cards_removed>=0),
  kara_removed integer not null check(kara_removed>=0),
  applied_at timestamptz not null,
  notification_seen_at timestamptz,
  unique(receipt_kind,receipt_id),
  check(cards_removed>0 or kara_removed>0)
);
alter table public.anticheat_asset_recovery_notices enable row level security;
revoke all on public.anticheat_asset_recovery_notices from public,anon,authenticated,service_role;
create index anticheat_asset_notices_pending_idx on public.anticheat_asset_recovery_notices(user_id,applied_at,id) where notification_seen_at is null;

create function public.anticheat_publish_asset_recovery_notice() returns trigger
language plpgsql security invoker set search_path='' as $$
declare kind text; cards integer; karas integer;
begin
  if tg_table_name='anticheat_smurf_sanctions' then
    kind:='active';cards:=cardinality(new.recovered_card_ids);karas:=new.recovered_karas;
  elsif tg_table_name='anticheat_deleted_smurf_recoveries' then
    kind:='deleted';cards:=cardinality(new.recovered_card_ids);karas:=new.recovered_karas;
  elsif tg_table_name='anticheat_deleted_account_sanctions' then
    kind:='deleted_accounts';cards:=(new.recovery->>'cards')::integer;karas:=(new.recovery->>'karas')::integer;
  else raise exception 'INVALID_NOTICE_SOURCE';end if;
  if cards>0 or karas>0 then
    insert into public.anticheat_asset_recovery_notices(receipt_kind,receipt_id,user_id,cards_removed,kara_removed,applied_at)
      values(kind,new.id,new.primary_user_id,cards,karas,new.applied_at) on conflict do nothing;
  end if;
  return new;
end;$$;
revoke all on function public.anticheat_publish_asset_recovery_notice() from public,anon,authenticated,service_role;
create trigger anticheat_active_recovery_notice after insert on public.anticheat_smurf_sanctions for each row execute function public.anticheat_publish_asset_recovery_notice();
create trigger anticheat_deleted_recovery_notice after insert on public.anticheat_deleted_smurf_recoveries for each row execute function public.anticheat_publish_asset_recovery_notice();
create trigger anticheat_deleted_accounts_recovery_notice after insert on public.anticheat_deleted_account_sanctions for each row execute function public.anticheat_publish_asset_recovery_notice();

-- Existing actual withdrawals also receive one notice. Zero-asset decisions
-- never produce a withdrawal notification; no balances are guessed.
insert into public.anticheat_asset_recovery_notices(receipt_kind,receipt_id,user_id,cards_removed,kara_removed,applied_at)
select 'active',id,primary_user_id,cardinality(recovered_card_ids),recovered_karas,applied_at from public.anticheat_smurf_sanctions where cardinality(recovered_card_ids)>0 or recovered_karas>0
union all select 'deleted',id,primary_user_id,cardinality(recovered_card_ids),recovered_karas,applied_at from public.anticheat_deleted_smurf_recoveries where cardinality(recovered_card_ids)>0 or recovered_karas>0
union all select 'deleted_accounts',id,primary_user_id,(recovery->>'cards')::integer,(recovery->>'karas')::integer,applied_at from public.anticheat_deleted_account_sanctions where(recovery->>'cards')::integer>0 or(recovery->>'karas')::integer>0
on conflict do nothing;

create or replace function public.get_my_pending_sanctions()
returns table(sanction_id uuid,sanction_type text,cards_removed integer,kara_removed integer,applied_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
  return query select pending.* from (
    select s.id,'SMURF_ASSET_RECOVERY'::text,s.cards_removed,s.kara_removed,s.applied_at from public.anticheat_asset_recovery_notices s
      where s.user_id=auth.uid() and s.notification_seen_at is null
        -- Old open tabs must not mislabel this new type as a referral warning.
        and coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-client-info','') like '%yokkai-assets-notice-v1%'
    union all
    select s.id,s.sanction_type,s.cards_removed,s.kara_removed,s.applied_at from public.account_sanctions s
      where s.user_id=auth.uid() and s.status='APPLIED' and s.published_at is not null and s.notification_seen_at is null
  )pending order by pending.applied_at,pending.id limit 20;
end;$$;
create or replace function public.acknowledge_my_sanction(p_sanction_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_player_not_banned();
  if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
  update public.account_sanctions set notification_seen_at=coalesce(notification_seen_at,clock_timestamp())
    where id=p_sanction_id and user_id=auth.uid() and status='APPLIED' and published_at is not null;
  if found then return true;end if;
  update public.anticheat_asset_recovery_notices set notification_seen_at=coalesce(notification_seen_at,clock_timestamp())
    where id=p_sanction_id and user_id=auth.uid();
  return found;
end;$$;
-- Existing reader/acknowledgement signatures and grants are unchanged.
notify pgrst,'reload schema';
commit;
