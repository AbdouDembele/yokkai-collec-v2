begin;

-- Transactional per-account admission. Cancellation does not refund the budget;
-- failed creations roll back both the offer and its admission increment.
create table public.trade_offer_submission_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  submissions integer not null check (submissions between 1 and 10)
);
alter table public.trade_offer_submission_limits enable row level security;
revoke all on public.trade_offer_submission_limits from public,anon,authenticated,service_role;

create index trade_offers_pending_sender_idx on public.trade_offers(from_user,to_user)
  where status='pending';

create function public.guard_trade_offer_submission() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); admission public.trade_offer_submission_limits%rowtype; stamp timestamptz; fresh boolean;
begin
  -- Operator imports are trusted, while every player RPC supplies auth.uid().
  if actor is null then return new; end if;
  if new.from_user is distinct from actor then raise exception 'AUTH_REQUIRED'; end if;
  -- Create the row once, then serialize requests before taking the wall clock.
  insert into public.trade_offer_submission_limits(user_id,window_started_at,submissions)
    values(actor,clock_timestamp(),1) on conflict(user_id) do nothing returning true into fresh;
  if not coalesce(fresh,false) then
  select * into admission from public.trade_offer_submission_limits where user_id=actor for update;
  stamp:=clock_timestamp();
  if admission.window_started_at<=stamp-interval '10 minutes' then
    update public.trade_offer_submission_limits set window_started_at=stamp,submissions=1 where user_id=actor;
  elsif admission.submissions>=10 then
    raise exception 'TRADE_OFFER_RATE_LIMITED';
  else
    update public.trade_offer_submission_limits set submissions=submissions+1 where user_id=actor;
  end if;
  end if;
  if (select count(*) from public.trade_offers where from_user=actor and status='pending')>=20 then
    raise exception 'TRADE_PENDING_LIMIT'; end if;
  if (select count(*) from public.trade_offers where from_user=actor and to_user=new.to_user and status='pending')>=5 then
    raise exception 'TRADE_PAIR_LIMIT'; end if;
  return new;
end; $$;
revoke all on function public.guard_trade_offer_submission() from public,anon,authenticated,service_role;
create trigger guard_trade_offer_submission before insert on public.trade_offers
  for each row execute function public.guard_trade_offer_submission();

notify pgrst,'reload schema';
commit;
