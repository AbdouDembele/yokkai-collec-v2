-- Performance (prod audit, point G). The license leaderboard
-- ('global:progress-score', the default ranking of the community page) scored
-- every owned card of every player on each call (up to 3.8 s observed).
-- Per-player totals (completion score, completed licenses, distinct cards) are
-- now stored in public.license_progress_scores, with the same method as
-- public.collection_scores:
--   * card changes append the player to public.license_score_changes; those
--     players are scored live until a pg_cron job folds them every minute;
--   * completed licenses also depend on the catalogue. The stored totals carry
--     the catalogue links cache version they were computed with. Whenever the
--     catalogue changed (links cache stale or rebuilt since), the leaderboard
--     uses the original live computation until the job rebuilt every total.
-- Results stay exact at all times: same formula, ranks, ties, visibility,
-- bans, deletion, friends, blocks, search, history key and response shape.
-- The ':legacy' variant and the other rankings are unchanged.
begin;
set local lock_timeout = '3s';

create table public.license_progress_scores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  completion_score bigint not null,
  completed_licenses bigint not null,
  distinct_cards bigint not null
);
alter table public.license_progress_scores enable row level security;
revoke all on public.license_progress_scores from public, anon, authenticated, service_role;

create table public.license_score_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null
);
alter table public.license_score_changes enable row level security;
revoke all on public.license_score_changes from public, anon, authenticated, service_role;
revoke all on sequence public.license_score_changes_id_seq from public, anon, authenticated, service_role;

-- links_version: catalogue_links_cache_state.built_version used by the stored
-- totals. total_licenses: number of binders in that catalogue version.
create table public.license_score_state (
  singleton boolean primary key default true check (singleton),
  links_version bigint not null,
  total_licenses bigint not null
);
alter table public.license_score_state enable row level security;
revoke all on public.license_score_state from public, anon, authenticated, service_role;

-- Same formula as the PROGRESS_SCORE_V2 branch of get_license_leaderboard:
-- distinct owned catalogue identities (weights C 1, R 2, SR 4, SSR 8, LR 15),
-- completed binders, distinct cards. p_user_ids null scores every player.
create function public.license_progress_totals(p_user_ids uuid[])
returns table (user_id uuid, completion_score bigint, completed_licenses bigint,
  distinct_cards bigint)
language sql
stable
set search_path = ''
as $$
  with owned as materialized (
    select distinct uc.user_id,uc.card_id,c.rarete_base from public.user_cards uc
      join public.cards c on c.id=uc.card_id
    where p_user_ids is null or uc.user_id=any(p_user_ids)
  ), progress as materialized (
    select o.user_id,l.binder_key,count(distinct o.card_id)::bigint owned
      from owned o join public.catalogue_binder_links l on l.card_id=o.card_id
      group by o.user_id,l.binder_key
  ), binder_totals as materialized (
    select l.binder_key,count(distinct l.card_id)::bigint total
      from public.catalogue_binder_links l
      where l.binder_key in (select p.binder_key from progress p)
      group by l.binder_key
  ), completed as (
    select p.user_id,count(*)::bigint completed_licenses
      from progress p join binder_totals b using(binder_key)
      where b.total>0 and p.owned=b.total group by p.user_id
  ), scores as (
    select o.user_id,sum(case o.rarete_base::text
        when 'LR' then 15 when 'SSR' then 8 when 'SR' then 4 when 'R' then 2 else 1 end)::bigint completion_score,
      count(*)::bigint distinct_cards
    from owned o group by o.user_id
  )
  select s.user_id,s.completion_score,coalesce(c.completed_licenses,0)::bigint,s.distinct_cards
  from scores s left join completed c using(user_id);
$$;
revoke all on function public.license_progress_totals(uuid[]) from public, anon, authenticated, service_role;

-- Statement triggers: one cheap insert per write statement, whatever its size.
-- Only ownership and rarity matter; shiny/evolved flags do not change the score.
create function public.log_license_score_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'cards' then
    insert into public.license_score_changes (user_id)
      select distinct owned.user_id
      from new_rows n join old_rows o on o.id = n.id
        join public.user_cards owned on owned.card_id = n.id
      where n.rarete_base is distinct from o.rarete_base;
  elsif tg_op = 'INSERT' then
    insert into public.license_score_changes (user_id)
      select distinct n.user_id from new_rows n;
  elsif tg_op = 'DELETE' then
    insert into public.license_score_changes (user_id)
      select distinct o.user_id from old_rows o;
  else
    insert into public.license_score_changes (user_id)
      select distinct changed.user_id from new_rows n join old_rows o on o.id = n.id
        cross join lateral (values (n.user_id), (o.user_id)) changed(user_id)
      where (n.user_id, n.card_id) is distinct from (o.user_id, o.card_id);
  end if;
  return null;
end;
$$;
revoke all on function public.log_license_score_change() from public, anon, authenticated, service_role;

create trigger license_score_insert after insert on public.user_cards
  referencing new table as new_rows
  for each statement execute function public.log_license_score_change();
create trigger license_score_delete after delete on public.user_cards
  referencing old table as old_rows
  for each statement execute function public.log_license_score_change();
create trigger license_score_update after update on public.user_cards
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.log_license_score_change();
create trigger license_score_rarity after update on public.cards
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.log_license_score_change();

-- Single writer (pg_cron). Waits for a fresh catalogue links cache. A newer
-- catalogue version rebuilds every total; otherwise only logged players are
-- rescored. Log rows are deleted first: the rescoring statement runs on a later
-- snapshot that includes every change it removed. If the links cache is
-- rebuilt meanwhile, the recorded version is older than the cache and the
-- leaderboard keeps the live path until the next run.
create function public.fold_license_score_changes()
returns void
language plpgsql
set search_path = ''
as $$
declare changed uuid[]; links_ready bigint; scored bigint;
begin
  if not pg_try_advisory_xact_lock(hashtext('public.fold_license_score_changes')) then
    return;
  end if;
  select s.built_version into links_ready from public.catalogue_links_cache_state s
    where s.singleton and s.version = s.built_version;
  if links_ready is null then return; end if;
  select st.links_version into scored from public.license_score_state st where st.singleton;

  if scored is distinct from links_ready then
    delete from public.license_score_changes;
    delete from public.license_progress_scores;
    insert into public.license_progress_scores
      select t.* from public.license_progress_totals(null) t
      where exists(select 1 from auth.users u where u.id = t.user_id);
    update public.license_score_state set links_version = links_ready,
      total_licenses = (select count(distinct l.binder_key) from public.catalogue_binder_links l)
      where singleton;
    return;
  end if;

  with removed as (
    delete from public.license_score_changes returning user_id
  ) select array_agg(distinct removed.user_id) into changed from removed;
  if changed is null then return; end if;
  delete from public.license_progress_scores s where s.user_id = any(changed);
  insert into public.license_progress_scores
    select t.* from public.license_progress_totals(changed) t
    where exists(select 1 from auth.users u where u.id = t.user_id);
end;
$$;
revoke all on function public.fold_license_score_changes() from public, anon, authenticated, service_role;

-- user_cards and cards are locked by the triggers above until commit, so the
-- initial totals are consistent with the first logged change. If the links
-- cache is stale right now, the recorded version cannot match its next build:
-- the leaderboard stays live until the job rebuilds.
insert into public.license_progress_scores
  select t.* from public.license_progress_totals(null) t
  where exists(select 1 from auth.users u where u.id = t.user_id);
insert into public.license_score_state (links_version, total_licenses)
  select s.built_version, (select count(distinct l.binder_key) from public.catalogue_binder_links l)
  from public.catalogue_links_cache_state s where s.singleton;
analyze public.license_progress_scores;

-- Private projection, called only by get_license_leaderboard once it has
-- authenticated the viewer and checked freshness. Mirrors the PROGRESS_SCORE_V2
-- branch, reading stored totals and scoring logged players live.
create function public.license_progress_leaderboard_cached(viewer uuid, page_offset integer,
  page_size integer, search_query text, friends_only boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with players as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public,
      exists(select 1 from public.friendships f where f.status='accepted' and
        ((f.user_id=viewer and f.friend_id=p.user_id) or (f.friend_id=viewer and f.user_id=p.user_id))) is_friend
    from public.user_profiles p join auth.users u on u.id=p.user_id
    where (p.is_public or p.user_id=viewer)
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
      and not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
  ), dirty as materialized (
    select distinct c.user_id from public.license_score_changes c
  ), scores as materialized (
    select s.user_id,s.completion_score,s.completed_licenses,s.distinct_cards
    from public.license_progress_scores s
    where not exists(select 1 from dirty d where d.user_id=s.user_id)
    union all
    select t.user_id,t.completion_score,t.completed_licenses,t.distinct_cards
    from public.license_progress_totals(array(select d.user_id from dirty d)) t
  ), counts as materialized (
    select p.*,coalesce(s.completion_score,0)::bigint completion_score,
      coalesce(s.completed_licenses,0)::bigint completed_licenses,
      coalesce(s.distinct_cards,0)::bigint distinct_cards
    from players p left join scores s using(user_id)
  ), ranked as materialized (
    select counts.*,rank() over(order by completion_score desc,completed_licenses desc) position,
      row_number() over(order by completion_score desc,completed_licenses desc,lower(pseudo),user_id) global_order
    from counts where is_public and distinct_cards>0
  ), visible as materialized (
    select * from ranked r where not public.users_blocked(viewer,r.user_id)
      and (not friends_only or r.is_friend or r.user_id=viewer)
  ), eligible as materialized (
    select * from visible where
      (search_query<>'' and strpos(lower(pseudo),lower(search_query))>0)
      or (search_query='' and (friends_only or global_order<=100))
  ), page as materialized (
    select * from eligible order by completion_score desc,completed_licenses desc,lower(pseudo),user_id
      offset page_offset limit page_size
  )
  select jsonb_build_object(
    'offset',page_offset,'limit',page_size,'query',search_query,'friendsOnly',friends_only,'topLimit',100,
    'total',(select count(*) from eligible),'rankedPlayers',(select count(*) from ranked),'binder',null,
    'metric','completion-score','scoreVersion',2,
    'completionWeights',jsonb_build_object('C',1,'R',2,'SR',4,'SSR',8,'LR',15),
    'catalogue',jsonb_build_object('totalCards',(select count(*) from public.cards),
      'totalLicenses',(select st.total_licenses from public.license_score_state st where st.singleton)),
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'position',position,'value',completion_score,
      'completionScore',completion_score,'completedLicenses',completed_licenses,'distinctCards',distinct_cards,'isFriend',is_friend
    ) order by completion_score desc,completed_licenses desc,lower(pseudo),user_id) from page),'[]'),
    'mine',(select jsonb_build_object('value',completion_score,'completionScore',completion_score,'isPublic',is_public,
      'completedLicenses',completed_licenses,'distinctCards',distinct_cards,'position',(select position from ranked where user_id=viewer))
      from counts where user_id=viewer),
    'profileStyles',coalesce((select jsonb_object_agg(user_id,public.billing_profile_cosmetics(user_id)) from page),'{}')
  );
$$;
revoke all on function public.license_progress_leaderboard_cached(uuid,integer,integer,text,boolean)
  from public, anon, authenticated, service_role;

-- Route the default ranking to the stored totals when they match the current
-- catalogue. Every other key, and a stale catalogue, keep the original code.
do $patch$
declare original text; changed text; marker text:='  -- BEGIN PROGRESS_SCORE_V2';
begin
  original:=pg_get_functiondef('public.get_license_leaderboard(text,integer,integer,text,boolean)'::regprocedure);
  if original like '%BEGIN PROGRESS_SCORE_CACHE%' then raise exception 'PROGRESS_SCORE_CACHE_ALREADY_APPLIED'; end if;
  if strpos(original,marker)=0 then raise exception 'PROGRESS_SCORE_V2_MARKER_MISSING'; end if;
  changed:=replace(original,marker,$branch$  -- BEGIN PROGRESS_SCORE_CACHE
  if chosen='global:progress-score' and exists(
    select 1 from public.catalogue_links_cache_state s join public.license_score_state st on st.singleton
    where s.singleton and s.version=s.built_version and st.links_version=s.built_version
  ) then
    return public.with_leaderboard_history(
      public.license_progress_leaderboard_cached(viewer,page_offset,page_size,search_query,friends_only),
      'licenses:progress-score:v2');
  end if;
  -- END PROGRESS_SCORE_CACHE
$branch$||marker);
  execute changed;
end;
$patch$;

select cron.schedule('fold-license-score-changes', '* * * * *',
  'select public.fold_license_score_changes();');

notify pgrst, 'reload schema';
commit;
