// One-time operator recipe. No credentials, connection, automatic execution or
// player identifiers in the repository. Baselines come from the locked snapshot
// taken immediately before the successful launch asset reset, never from now.
export function resetLaunchProgressSQL(baseline, { commit = false } = {}) {
  const fields = [
    "regular",
    "decision",
    "decisionOpened",
    "decisionEverOpened",
    "auctions",
    "trades",
    "evolved"
  ];
  if (
    typeof commit !== "boolean" ||
    !Array.isArray(baseline) ||
    !baseline.length ||
    new Set(baseline.map(row => row.user_id)).size !== baseline.length ||
    baseline.some(
      row =>
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.user_id) ||
        fields.some(
          key =>
            !Number.isSafeInteger(row[key]) ||
            row[key] < 0 ||
            row[key] > 2147483647
        )
    )
  )
    throw new Error("A complete, unique launch snapshot baseline is required");
  const json = JSON.stringify(
    baseline.map(row =>
      Object.fromEntries(["user_id", ...fields].map(key => [key, row[key]]))
    )
  ).replaceAll("'", "''");
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='120s';
set local idle_in_transaction_session_timeout='60s';
do $$ begin
  if auth.uid() is not null then raise exception 'OPERATOR_CONNECTION_REQUIRED'; end if;
  if not pg_try_advisory_xact_lock(20261026,1610) then raise exception 'LAUNCH_RESET_ALREADY_RUNNING'; end if;
end $$;
-- Writers resume after commit and increment the adjusted counters normally.
lock table auth.users,public.user_profiles,public.user_cards,public.decision_packs,
  public.user_achievement_stats,public.user_achievements,public.notifications,
  public.wishlists in share row exclusive mode;
create temporary table launch_progress_baseline on commit drop as
  select * from jsonb_to_recordset('${json}'::jsonb) as b(
    user_id uuid,regular integer,decision integer,"decisionOpened" integer,"decisionEverOpened" integer,
    auctions integer,trades integer,evolved integer);
do $$ begin
  if exists(select 1 from public.user_achievement_stats where profile_decision_packs_offset<>0)
    then raise exception 'LAUNCH_PROGRESS_ALREADY_RESET'; end if;
  if exists(select 1 from launch_progress_baseline b join auth.users u on u.id=b.user_id
    left join public.user_achievement_stats s on s.user_id=b.user_id
    where s.user_id is null or s.regular_packs_opened<b.regular
      or s.decision_packs_completed<b.decision or s.auctions_won<b.auctions
      or s.trades_completed<b.trades or s.ssr_evolved_to_lr<b.evolved
      or (select count(*) from public.decision_packs d where d.user_id=b.user_id)<b."decisionOpened")
    then raise exception 'LAUNCH_PROGRESS_BASELINE_MISMATCH'; end if;
end $$;
create temporary table launch_progress_before on commit drop as
  select to_jsonb(s) original,
    to_jsonb(s) || jsonb_build_object(
      'regular_packs_opened',s.regular_packs_opened-coalesce(b.regular,0),
      'decision_packs_completed',s.decision_packs_completed-coalesce(b.decision,0),
      'auctions_won',s.auctions_won-coalesce(b.auctions,0),
      'trades_completed',s.trades_completed-coalesce(b.trades,0),
      'ssr_evolved_to_lr',s.ssr_evolved_to_lr-coalesce(b.evolved,0),
      'profile_decision_packs_offset',coalesce(b."decisionOpened",0)) expected,
    s.user_id
  from public.user_achievement_stats s left join launch_progress_baseline b using(user_id);
-- Only old openings whose replacement has not been opened since launch qualify.
-- Recheck under the same locks; an opening during preparation is never refunded.
create temporary table launch_progress_profiles on commit drop as
  select p.user_id,to_jsonb(p) || case when b."decisionEverOpened">0
      and (select count(*) from public.decision_packs d where d.user_id=p.user_id)=b."decisionOpened"
      then jsonb_build_object('next_decision_pack_at',least(p.next_decision_pack_at,transaction_timestamp()))
      else '{}'::jsonb end expected,
    b."decisionEverOpened">0
      and (select count(*) from public.decision_packs d where d.user_id=p.user_id)=b."decisionOpened"
      and p.next_decision_pack_at>transaction_timestamp() reset_cooldown
  from public.user_profiles p left join launch_progress_baseline b using(user_id);
create temporary table launch_progress_protected on commit drop as
  select table_name,md5(coalesce(string_agg(md5(row::text),'' order by row::text),'')) digest
  from (
    select 'accounts' table_name,to_jsonb(t) row from auth.users t
    union all select 'cards',to_jsonb(t) from public.user_cards t
    union all select 'wishlists',to_jsonb(t) from public.wishlists t
    union all select 'decisionHistory',to_jsonb(t) from public.decision_packs t
    union all select 'otherNotifications',to_jsonb(t) from public.notifications t where type<>'achievement_completed'
  ) protected group by table_name;
create temporary table launch_progress_receipt on commit drop as
  select count(*) achievement_rows,count(*) filter(where claimed_at is not null) claimed_rows from public.user_achievements;

update public.user_achievement_stats s set
  regular_packs_opened=s.regular_packs_opened-b.regular,
  decision_packs_completed=s.decision_packs_completed-b.decision,
  auctions_won=s.auctions_won-b.auctions,
  trades_completed=s.trades_completed-b.trades,
  ssr_evolved_to_lr=s.ssr_evolved_to_lr-b.evolved,
  profile_decision_packs_offset=b."decisionOpened"
from launch_progress_baseline b where s.user_id=b.user_id;
update public.user_profiles p set next_decision_pack_at=transaction_timestamp()
  from launch_progress_profiles saved where saved.user_id=p.user_id and saved.reset_cooldown;
delete from public.user_achievements;
delete from public.notifications where type='achievement_completed';
-- No rewards are paid here. Post-launch progress stays available to normal
-- achievement evaluation on subsequent player actions; all completion/claim
-- flags are cleared now, as explicitly requested.
do $$ begin
  if exists(select 1 from launch_progress_profiles saved full join public.user_profiles p using(user_id)
      where saved.expected is distinct from to_jsonb(p))
    then raise exception 'LAUNCH_PROGRESS_PROFILES_CHANGED'; end if;
  if exists(select 1 from launch_progress_before b full join public.user_achievement_stats s using(user_id)
      where b.expected is distinct from to_jsonb(s))
    then raise exception 'LAUNCH_PROGRESS_COUNTERS_CHANGED'; end if;
  if exists(select 1 from public.user_achievements) or exists(
      select 1 from public.notifications where type='achievement_completed')
    then raise exception 'LAUNCH_PROGRESS_ACHIEVEMENTS_NOT_RESET'; end if;
  if exists(
    (select * from launch_progress_protected except
      select table_name,md5(coalesce(string_agg(md5(row::text),'' order by row::text),'')) digest from (
        select 'accounts' table_name,to_jsonb(t) row from auth.users t
        union all select 'cards',to_jsonb(t) from public.user_cards t
        union all select 'wishlists',to_jsonb(t) from public.wishlists t
        union all select 'decisionHistory',to_jsonb(t) from public.decision_packs t
        union all select 'otherNotifications',to_jsonb(t) from public.notifications t where type<>'achievement_completed'
      ) protected group by table_name)) then raise exception 'LAUNCH_PROGRESS_PROTECTED_DATA_CHANGED'; end if;
end $$;
select jsonb_build_object(
  'committed',${commit},'players',(select count(*) from public.user_profiles),
  'oldRegularRemoved',(select coalesce(sum((original->>'regular_packs_opened')::bigint-(expected->>'regular_packs_opened')::bigint),0) from launch_progress_before),
  'regularRetained',(select coalesce(sum(regular_packs_opened),0) from public.user_achievement_stats),
  'oldDecisionExcluded',(select coalesce(sum(profile_decision_packs_offset),0) from public.user_achievement_stats),
  'decisionRetained',(select count(*) from public.decision_packs)-(select coalesce(sum(profile_decision_packs_offset),0) from public.user_achievement_stats),
  'achievementsCleared',(select achievement_rows from launch_progress_receipt),
  'claimedFlagsCleared',(select claimed_rows from launch_progress_receipt),
  'remainingAchievements',(select count(*) from public.user_achievements),
  'decisionCooldownsReset',(select count(*) from launch_progress_profiles where reset_cooldown));
${commit ? "commit" : "rollback"};
`;
}
