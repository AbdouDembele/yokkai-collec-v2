-- Follow-up to #568: the GIF verification route must refuse banned accounts and
-- bound each player's calls, which spend the shared GIPHY API quota.
-- Codes: ACCOUNT_BANNED, GIF_VERIFY_RATE_LIMITED, GIF_INVALID.
begin;

-- One row per player, shared by every app instance; it never grows per call.
create table public.gif_verification_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_started_at timestamptz not null,
  minute_requests integer not null check (minute_requests between 1 and 20),
  day_started_at timestamptz not null,
  day_requests integer not null check (day_requests between 1 and 200)
);
alter table public.gif_verification_limits enable row level security;
revoke all on table public.gif_verification_limits from public,anon,authenticated,service_role;

-- Called by the route with the player's session before any GIPHY request.
-- Limits: 20 per minute and 200 per rolling day window. Returns the rating
-- recorded in the last 7 days, if any, so the route can skip GIPHY.
create function public.consume_gif_verification(p_gif_id text)
returns text language plpgsql volatile security definer set search_path='' as $$
declare player uuid:=auth.uid(); stamp timestamptz:=clock_timestamp(); admitted boolean; cached text;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_gif_id is null or p_gif_id !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'GIF_INVALID' using errcode='P0001'; end if;
  insert into public.gif_verification_limits(user_id,minute_started_at,minute_requests,day_started_at,day_requests)
    values(player,stamp,1,stamp,1)
  on conflict(user_id) do update set
    minute_started_at=case when gif_verification_limits.minute_started_at+interval '1 minute'<=stamp then stamp else gif_verification_limits.minute_started_at end,
    minute_requests=case when gif_verification_limits.minute_started_at+interval '1 minute'<=stamp then 1 else gif_verification_limits.minute_requests+1 end,
    day_started_at=case when gif_verification_limits.day_started_at+interval '1 day'<=stamp then stamp else gif_verification_limits.day_started_at end,
    day_requests=case when gif_verification_limits.day_started_at+interval '1 day'<=stamp then 1 else gif_verification_limits.day_requests+1 end
  where (gif_verification_limits.minute_started_at+interval '1 minute'<=stamp or gif_verification_limits.minute_requests<20)
    and (gif_verification_limits.day_started_at+interval '1 day'<=stamp or gif_verification_limits.day_requests<200)
  returning true into admitted;
  if admitted is not true then raise exception 'GIF_VERIFY_RATE_LIMITED' using errcode='P0001'; end if;
  select rating into cached from public.giphy_gif_ratings
    where gif_id=p_gif_id and verified_at>stamp-interval '7 days';
  return cached;
end; $$;

revoke all on function public.consume_gif_verification(text) from public,anon,authenticated,service_role;
grant execute on function public.consume_gif_verification(text) to authenticated;
notify pgrst,'reload schema';
commit;
