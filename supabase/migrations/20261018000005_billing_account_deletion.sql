begin;

alter table public.billing_accounts add column deletion_confirmed_at timestamptz;

-- Serialize the purchase claim with the existing committed account-deletion
-- fence. A worker already holding a lease may finish recording its provider IDs;
-- deletion cannot acquire that lease until the worker releases it or it expires.
create or replace function public.billing_claim(p_user uuid, p_scope text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare a public.billing_accounts;
begin
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user::text,0));
  if exists(select 1 from public.account_deletion_log where user_id=p_user) then
    raise exception 'ACCOUNT_DELETED';
  end if;
  insert into public.billing_accounts(user_id,scope) values(p_user,p_scope) on conflict(user_id) do nothing;
  update public.billing_accounts set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
    where user_id=p_user and scope=p_scope and (lease_until is null or lease_until<clock_timestamp()) returning * into a;
  if a.id is null then raise exception 'BILLING_BUSY'; end if;
  return to_jsonb(a);
end;
$$;

create function public.billing_claim_deletion(p_user uuid,p_scope text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare a public.billing_accounts;
begin
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user::text,0));
  if not exists(select 1 from public.account_deletion_log where user_id=p_user) then
    raise exception 'ACCOUNT_DELETION_NOT_STARTED';
  end if;
  select * into a from public.billing_accounts where user_id=p_user for update;
  if a.id is null then return null; end if;
  if a.scope<>p_scope then raise exception 'BILLING_REVIEW_REQUIRED'; end if;
  if a.lease_until>clock_timestamp() then raise exception 'BILLING_BUSY'; end if;
  update public.billing_accounts set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
    where id=a.id returning * into a;
  return to_jsonb(a);
end;
$$;

create function public.billing_confirm_deletion(p_id uuid,p_token uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.billing_accounts set deletion_confirmed_at=clock_timestamp(),active=false,status='canceled',
    cancel_at_period_end=false,period_end=null,verified_at=clock_timestamp()
    where id=p_id and lease_token=p_token and lease_until>clock_timestamp()
      and exists(select 1 from public.account_deletion_log where user_id=billing_accounts.user_id);
  if not found then raise exception 'BILLING_LEASE_LOST'; end if;
end;
$$;

-- Restoration tooling using the core without a Stripe adapter also fails closed.
-- The previous preparation function remains inaccessible to players.
alter function public.prepare_account_deletion(uuid) rename to prepare_account_deletion_without_billing;
revoke all on function public.prepare_account_deletion_without_billing(uuid) from public,anon,authenticated,service_role;
create function public.prepare_account_deletion(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user_id::text,0));
  if exists(select 1 from public.billing_accounts where user_id=p_user_id
    and (stripe_customer_id is not null or checkout_id is not null
      or customer_started_at is not null or checkout_started_at is not null
      or lease_until>clock_timestamp())
    and (deletion_confirmed_at is null or lease_until>clock_timestamp())) then
    raise exception 'BILLING_CANCELLATION_REQUIRED';
  end if;
  return public.prepare_account_deletion_without_billing(p_user_id);
end;
$$;
revoke all on function public.billing_claim_deletion(uuid,text),public.billing_confirm_deletion(uuid,uuid),public.prepare_account_deletion(uuid)
  from public,anon,authenticated;
grant execute on function public.billing_claim_deletion(uuid,text),public.billing_confirm_deletion(uuid,uuid),public.prepare_account_deletion(uuid)
  to service_role;
commit;
