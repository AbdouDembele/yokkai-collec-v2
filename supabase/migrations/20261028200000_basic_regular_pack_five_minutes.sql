begin;

-- Regular Pack recharge is shared by every tier. The existing authoritative
-- draw/status RPCs still enforce five timed packs for Basic, ten for Pro, and
-- keep referral/purchased bonus packs separate from the timed reserve.
alter table public.user_profiles
  alter column regular_pack_interval_seconds set default 300;

create or replace function public.billing_sync_pack_timing(p_user uuid,p_cutoff timestamptz default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  profile public.user_profiles;
  stamp timestamptz;
  decision_seconds integer;
begin
  select * into profile from public.user_profiles where user_id=p_user for update;
  if not found then return; end if;
  stamp:=clock_timestamp();
  decision_seconds:=case when public.billing_has_game_pro(p_user) then 43200 else 86400 end;
  if profile.regular_pack_interval_seconds=300
    and profile.decision_pack_interval_seconds=decision_seconds then return; end if;

  -- A legacy 600-second timer keeps its earned stock and fractional progress.
  -- A tier change at the shared interval must leave the deadline EXACTLY alone:
  -- clamping here would silently erase half of a full ten-pack Pro reserve.
  -- p_cutoff remains part of the existing server-only ABI; tier expiry no
  -- longer changes the Regular Pack rate, so no expiry cutoff is needed.
  update public.user_profiles set
    next_regular_pack_at=case when profile.regular_pack_interval_seconds=300
      then profile.next_regular_pack_at
      else stamp+
        (greatest(profile.next_regular_pack_at,stamp-make_interval(secs=>4*profile.regular_pack_interval_seconds))-stamp)
        *(300::double precision/profile.regular_pack_interval_seconds) end,
    regular_pack_interval_seconds=300,
    decision_pack_interval_seconds=decision_seconds
    where user_id=p_user;
end;
$$;
revoke all on function public.billing_sync_pack_timing(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.billing_sync_pack_timing(uuid,timestamptz) to service_role;

-- Convert existing Basic timers once, using a single deployment instant.
-- Neither Pro deadlines nor bonus balances nor Decision Pack history move.
do $$
declare stamp timestamptz:=clock_timestamp();
begin
  update public.user_profiles set
    next_regular_pack_at=stamp+
      (greatest(next_regular_pack_at,stamp-make_interval(secs=>4*regular_pack_interval_seconds))-stamp)
      *(300::double precision/regular_pack_interval_seconds),
    regular_pack_interval_seconds=300
    where regular_pack_interval_seconds<>300;
end;
$$;

commit;
