-- Performance (prod audit, point G). The collection leaderboard rescored every
-- owned card of every player on each call (about 1.5 s, up to the 8 s timeout,
-- 1 TB of temporary files in 9 days). Scores are now stored per player in
-- public.collection_scores. Card changes append the player to
-- public.collection_score_changes (insert-only, no row lock); those players are
-- scored live by the leaderboard until a pg_cron job folds them into the table
-- every minute. Results stay exact at all times: same scoring rules, ranks,
-- visibility, blocks, search and breakdown. Visibility filters (public profile,
-- bans, deletion, friends, blocks) are still applied live at read time.
begin;
set local lock_timeout = '3s';

create table public.collection_scores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  score bigint not null,
  unique_variants bigint not null,
  infinity_variants bigint not null,
  shiny_variants bigint not null
);
alter table public.collection_scores enable row level security;
revoke all on public.collection_scores from public, anon, authenticated, service_role;

create table public.collection_score_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null
);
alter table public.collection_score_changes enable row level security;
revoke all on public.collection_score_changes from public, anon, authenticated, service_role;
revoke all on sequence public.collection_score_changes_id_seq from public, anon, authenticated, service_role;

-- Same scoring as leaderboard_collection_without_styles: one variant per card
-- (standard, Infinity, natural Shiny), duplicates capped at +80 %.
-- p_user_ids null scores every player.
create function public.collection_score_totals(p_user_ids uuid[])
returns table (user_id uuid, score bigint, unique_variants bigint,
  infinity_variants bigint, shiny_variants bigint)
language sql
stable
set search_path = ''
as $$
  with variants as (
    select owned.user_id,owned.card_id,c.rarete_base::text rarity,
      case when c.rarete_base='SSR' and (owned.is_evolved or owned.is_shiny) then 'infinity'
        when c.rarete_base='LR' and owned.is_evolved then 'infinity'
        when c.rarete_base='LR' and owned.is_shiny then 'shiny'
        else 'standard' end variant,
      count(*) copies
    from public.user_cards owned join public.cards c on c.id=owned.card_id
    where p_user_ids is null or owned.user_id=any(p_user_ids)
    group by owned.user_id,owned.card_id,c.rarete_base,variant
  ), values_per_variant as (
    select variants.*,case
      when rarity='LR' and variant='shiny' then 50000
      when rarity='LR' and variant='infinity' then 18000
      when rarity='SSR' and variant='infinity' then 6000
      when rarity='LR' then 5000 when rarity='SSR' then 1000
      when rarity='SR' then 100 when rarity='R' then 25 else 5 end base_points
    from variants
  ), scored as (
    select values_per_variant.*,base_points*(5+least(copies-1,4))/5 points
    from values_per_variant
  )
  select s.user_id,coalesce(sum(s.points),0)::bigint,count(s.card_id),
    count(s.card_id) filter(where s.variant='infinity'),
    count(s.card_id) filter(where s.variant='shiny')
  from scored s group by s.user_id;
$$;
revoke all on function public.collection_score_totals(uuid[]) from public, anon, authenticated, service_role;

-- Statement triggers: one cheap insert per write statement, whatever its size.
-- Security definer because players may write their own user_cards rows
-- (RLS); the log itself stays private.
create function public.log_collection_score_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'cards' then
    insert into public.collection_score_changes (user_id)
      select distinct owned.user_id
      from new_rows n join old_rows o on o.id = n.id
        join public.user_cards owned on owned.card_id = n.id
      where n.rarete_base is distinct from o.rarete_base;
  elsif tg_op = 'INSERT' then
    insert into public.collection_score_changes (user_id)
      select distinct n.user_id from new_rows n;
  elsif tg_op = 'DELETE' then
    insert into public.collection_score_changes (user_id)
      select distinct o.user_id from old_rows o;
  else
    insert into public.collection_score_changes (user_id)
      select distinct changed.user_id from new_rows n join old_rows o on o.id = n.id
        cross join lateral (values (n.user_id), (o.user_id)) changed(user_id)
      where (n.user_id, n.card_id, n.is_shiny, n.is_evolved)
        is distinct from (o.user_id, o.card_id, o.is_shiny, o.is_evolved);
  end if;
  return null;
end;
$$;
revoke all on function public.log_collection_score_change() from public, anon, authenticated, service_role;

create trigger collection_score_insert after insert on public.user_cards
  referencing new table as new_rows
  for each statement execute function public.log_collection_score_change();
create trigger collection_score_delete after delete on public.user_cards
  referencing old table as old_rows
  for each statement execute function public.log_collection_score_change();
create trigger collection_score_update after update on public.user_cards
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.log_collection_score_change();
create trigger collection_score_rarity after update on public.cards
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.log_collection_score_change();

-- Single writer (pg_cron). The log rows are deleted first: the rescoring
-- statement then runs on a later snapshot that includes every change it
-- removed; changes committed afterwards stay in the log for the next run.
create function public.fold_collection_score_changes()
returns void
language plpgsql
set search_path = ''
as $$
declare changed uuid[];
begin
  if not pg_try_advisory_xact_lock(hashtext('public.fold_collection_score_changes')) then
    return;
  end if;
  with removed as (
    delete from public.collection_score_changes returning user_id
  ) select array_agg(distinct removed.user_id) into changed from removed;
  if changed is null then return; end if;
  delete from public.collection_scores s where s.user_id = any(changed);
  insert into public.collection_scores
    select t.* from public.collection_score_totals(changed) t
    where exists(select 1 from auth.users u where u.id = t.user_id);
end;
$$;
revoke all on function public.fold_collection_score_changes() from public, anon, authenticated, service_role;

-- user_cards and cards are locked by the triggers above until commit, so the
-- initial scores are consistent with the first logged change.
insert into public.collection_scores
  select t.* from public.collection_score_totals(null) t
  where exists(select 1 from auth.users u where u.id = t.user_id);
analyze public.collection_scores;

CREATE OR REPLACE FUNCTION public.leaderboard_collection_without_styles(p_offset integer, p_limit integer, p_query text, p_friends_only boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer uuid:=auth.uid(); result jsonb;
  page_offset integer:=greatest(0,least(coalesce(p_offset,0),1000000));
  page_size integer:=greatest(1,least(coalesce(p_limit,100),100));
  search_query text:=left(btrim(coalesce(p_query,'')),64);
  friends_only boolean:=coalesce(p_friends_only,false);
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.assert_player_not_banned();
  if not exists(select 1 from public.user_profiles where user_id=viewer)
    or exists(select 1 from public.account_deletion_log where user_id=viewer)
    then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;

  with players as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public,
      exists(select 1 from public.friendships f where f.status='accepted' and
        ((f.user_id=viewer and f.friend_id=p.user_id) or (f.friend_id=viewer and f.user_id=p.user_id))) is_friend
    from public.user_profiles p join auth.users u on u.id=p.user_id
    where (p.is_public or p.user_id=viewer)
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
      and not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
  ), dirty as materialized (
    -- Players whose cards changed since the last fold: scored live.
    select distinct c.user_id from public.collection_score_changes c
  ), scores as materialized (
    select s.user_id,s.score,s.unique_variants,s.infinity_variants,s.shiny_variants
    from public.collection_scores s
    where not exists(select 1 from dirty d where d.user_id=s.user_id)
    union all
    select l.user_id,l.score,l.unique_variants,l.infinity_variants,l.shiny_variants
    from public.collection_score_totals(array(select d.user_id from dirty d)) l
  ), totals as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public,p.is_friend,
      coalesce(s.score,0)::bigint score,coalesce(s.unique_variants,0)::bigint unique_variants,
      coalesce(s.infinity_variants,0)::bigint infinity_variants,
      coalesce(s.shiny_variants,0)::bigint shiny_variants
    from players p left join scores s on s.user_id=p.user_id
  ), ranked as materialized (
    -- Competition ranking: 1, 2, 2, 4. Display order never breaks a score tie.
    select totals.*,rank() over(order by score desc) position,
      row_number() over(order by score desc,lower(pseudo),user_id) global_order
    from totals where is_public and score>0
  ), visible as materialized (
    select * from ranked r where not public.users_blocked(viewer,r.user_id)
      and (not friends_only or r.is_friend or r.user_id=viewer)
  ), eligible as materialized (
    select * from visible where
      (search_query<>'' and strpos(lower(pseudo),lower(search_query))>0)
      or (search_query='' and (friends_only or global_order<=100))
  ), page as (
    select * from eligible order by score desc,lower(pseudo),user_id
      offset page_offset limit page_size
  ), viewer_scored as (
    select v.*,v.base_points*(5+least(v.copies-1,4))/5 points from (
      select variants.*,case
        when rarity='LR' and variant='shiny' then 50000
        when rarity='LR' and variant='infinity' then 18000
        when rarity='SSR' and variant='infinity' then 6000
        when rarity='LR' then 5000 when rarity='SSR' then 1000
        when rarity='SR' then 100 when rarity='R' then 25 else 5 end base_points
      from (
        select owned.card_id,c.rarete_base::text rarity,
          case when c.rarete_base='SSR' and (owned.is_evolved or owned.is_shiny) then 'infinity'
            when c.rarete_base='LR' and owned.is_evolved then 'infinity'
            when c.rarete_base='LR' and owned.is_shiny then 'shiny'
            else 'standard' end variant,
          count(*) copies
        from public.user_cards owned join public.cards c on c.id=owned.card_id
        where owned.user_id=viewer and exists(select 1 from players p where p.user_id=viewer)
        group by owned.card_id,c.rarete_base,variant
      ) variants
    ) v
  ), breakdown as (
    select rarity,variant,sum(points)::bigint points,count(*) unique_variants,
      sum(copies)::bigint copies,sum(points-base_points)::bigint duplicate_points
    from viewer_scored group by rarity,variant
  )
  select jsonb_build_object(
    'rulesVersion',1,'offset',page_offset,'limit',page_size,
    'query',search_query,'friendsOnly',friends_only,'topLimit',100,
    'total',(select count(*) from eligible),'rankedPlayers',(select count(*) from ranked),
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'position',position,
      'score',score,'isFriend',is_friend,'uniqueVariants',unique_variants,
      'infinityVariants',infinity_variants,'shinyVariants',shiny_variants
    ) order by score desc,lower(pseudo),user_id) from page),'[]'::jsonb),
    'mine',(select jsonb_build_object('score',score,'isPublic',is_public,
      'position',(select position from ranked where user_id=viewer),
      'uniqueVariants',unique_variants,'infinityVariants',infinity_variants,'shinyVariants',shiny_variants,
      'breakdown',coalesce((select jsonb_agg(jsonb_build_object(
        'rarity',rarity,'variant',variant,'points',points,'uniqueVariants',unique_variants,
        'copies',copies,'duplicatePoints',duplicate_points
      ) order by points desc,rarity,variant) from breakdown),'[]'::jsonb)
    ) from totals where user_id=viewer)
  ) into result;
  return result;
end; $function$;

select cron.schedule('fold-collection-score-changes', '* * * * *',
  'select public.fold_collection_score_changes();');

commit;
