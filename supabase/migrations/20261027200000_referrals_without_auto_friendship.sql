begin;

-- Referral verification rewards both players without creating a friendship.
-- Existing friendships and pending friend requests are preserved.
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

end;
$$;
revoke all on function public.complete_referral_after_verification(uuid, timestamptz)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
