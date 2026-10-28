begin;

-- A verified referral also makes both players friends, unless either side
-- already blocked the other or is being deleted. Existing pairs are kept as is.
create or replace function public.complete_referral_after_verification(
  p_referred_id uuid,
  p_verified_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral public.referrals;
begin
  if p_referred_id is null or p_verified_at is null then return; end if;

  select * into referral
    from public.referrals
    where referred_id = p_referred_id
    for update;
  if not found or referral.rewarded_at is not null then return; end if;

  update public.user_profiles
    set bonus_regular_packs = bonus_regular_packs + referral.reward_packs
    where user_id = referral.referrer_id;
  if not found then return; end if;

  update public.user_profiles
    set bonus_regular_packs = bonus_regular_packs + referral.reward_packs
    where user_id = referral.referred_id;

  update public.referrals
    set verified_at = p_verified_at,
        rewarded_at = clock_timestamp()
    where id = referral.id and rewarded_at is null;

  if not public.users_blocked(referral.referrer_id, referral.referred_id)
    and not exists (
      select 1 from public.account_deletion_log
      where user_id in (referral.referrer_id, referral.referred_id)
    ) then
    insert into public.friendships (user_id, friend_id, status)
      values (referral.referrer_id, referral.referred_id, 'accepted')
      on conflict do nothing;
  end if;
end;
$$;
revoke all on function public.complete_referral_after_verification(uuid, timestamptz)
  from public, anon, authenticated;

-- Only pending rows are requests: an accepted insert must not notify.
create or replace function public.notify_friend_request()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status = 'pending' then
    insert into public.notifications(user_id,type,reference_id)
    values(new.friend_id,'friend_request',new.id)
    on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.notify_friend_request() from public,anon,authenticated;

commit;
