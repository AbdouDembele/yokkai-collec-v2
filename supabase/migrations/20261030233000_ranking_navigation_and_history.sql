begin;
set local lock_timeout='3s';

-- Observations are made by existing authorized readers. No backfilled ranks.
create table public.leaderboard_rank_observations (
  user_id uuid not null references auth.users(id) on delete cascade,
  ranking_key text not null check(length(ranking_key)<=540),
  observed_day date not null,
  position bigint not null check(position>0),
  primary key(user_id,ranking_key,observed_day)
);
create index leaderboard_rank_observations_day on public.leaderboard_rank_observations(observed_day);
alter table public.leaderboard_rank_observations enable row level security;
revoke all on public.leaderboard_rank_observations from public,anon,authenticated,service_role;

create function public.with_leaderboard_history(p_result jsonb,p_key text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); day date:=(now() at time zone 'UTC')::date;
  target record; baseline record; samples jsonb; history jsonb:='{}';
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_player_not_banned();
  if length(p_key)>540 then raise exception 'INVALID_RANKING_KEY'; end if;
  -- Only IDs and positions already permitted by the original reader are used.
  for target in
    select distinct on (id) id,position from (
      select (e->>'userId')::uuid id,(e->>'position')::bigint position
      from jsonb_array_elements(p_result->'entries') e
      union all
      select viewer,(p_result->'mine'->>'position')::bigint
      where coalesce((p_result->'mine'->>'isPublic')::boolean,false)
    ) permitted where position>0
  loop
    insert into public.leaderboard_rank_observations(user_id,ranking_key,observed_day,position)
      values(target.id,p_key,day,target.position)
      on conflict(user_id,ranking_key,observed_day) do update set position=excluded.position
      where leaderboard_rank_observations.position is distinct from excluded.position;
    select o.observed_day,o.position into baseline from public.leaderboard_rank_observations o
      where o.user_id=target.id and o.ranking_key=p_key and o.observed_day<day
      order by (o.observed_day<=day-7) desc,
        case when o.observed_day<=day-7 then o.observed_day end desc,
        o.observed_day asc limit 1;
    select coalesce(jsonb_agg(jsonb_build_object('day',s.observed_day,'position',s.position) order by s.observed_day),'[]')
      into samples from (
        select observed_day,position from public.leaderboard_rank_observations
        where user_id=target.id and ranking_key=p_key
        order by observed_day desc limit 8
      ) s;
    history:=history||jsonb_build_object(target.id,jsonb_build_object(
      'delta',case when baseline.position is null then null else baseline.position-target.position end,
      'since',baseline.observed_day,'observations',samples));
  end loop;
  delete from public.leaderboard_rank_observations where observed_day<day-35;
  return p_result||jsonb_build_object('history',history);
end; $$;
revoke all on function public.with_leaderboard_history(jsonb,text) from public,anon,authenticated,service_role;

-- Keep all scoring, privacy, blocks, ties and page projections intact.
do $patch$
declare signature text; original text; changed text; key_expression text;
begin
  foreach signature in array array[
    'public.get_collection_leaderboard(integer,integer,text,boolean)',
    'public.get_profile_likes_leaderboard(integer,integer,text,boolean)',
    'public.get_license_leaderboard(text,integer,integer,text,boolean)'
  ] loop
    original:=pg_get_functiondef(signature::regprocedure);
    key_expression:=case when signature like '%get_collection_%' then '''collection'''
      when signature like '%get_profile_%' then '''likes''' else '''licenses:'' || chosen' end;
    changed:=replace(original,'return result',
      'result := public.with_leaderboard_history(result,'||key_expression||'); return result');
    if changed=original then raise exception 'RANK_HISTORY_PATCH_MISMATCH'; end if;
    execute changed;
  end loop;
end $patch$;

-- Lightweight dropdown metadata: alphabetic ordering happens before pagination.
create function public.get_ranking_license_choices(
  p_query text default '',p_category text default '',p_prefix text default '',
  p_stable boolean default true,p_offset integer default 0,p_limit integer default 72
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_player_not_banned();
  if not exists(select 1 from public.user_profiles where user_id=viewer)
    or exists(select 1 from public.account_deletion_log where user_id=viewer)
    then raise exception 'PROFILE_MISSING'; end if;
  with links as materialized (
    select binder_key,display_name as license,card_id,category,source_license
      from public.catalogue_binder_links where coalesce(p_stable,true)
    union all
    select f.franchise,f.franchise,f.card_id,c.categorie,f.franchise
      from public.card_franchises f join public.cards c on c.id=f.card_id
      where not coalesce(p_stable,true)
  ), grouped as materialized (
    select binder_key,min(license) license,count(distinct card_id) total,
      bool_or(p_query='' or strpos(lower(license),lower(left(p_query,120)))>0
        or strpos(lower(source_license),lower(left(p_query,120)))>0) matches
    from links where coalesce(p_category,'')='' or category=p_category group by binder_key
  ), eligible as materialized (
    select * from grouped where matches and (coalesce(p_prefix,'')='' or
      strpos(regexp_replace(lower(translate(license,
        'ÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝàáâãäåèéêëìíîïòóôõöùúûüýÿÇç',
        'AAAAAAEEEEIIIIOOOOOUUUUYaaaaaaeeeeiiiiooooouuuuyyCc')),'^[^[:alnum:]]+',''),lower(left(p_prefix,120)))=1)
  ), page as (
    select * from eligible order by lower(license) collate "C",binder_key
      offset greatest(0,least(coalesce(p_offset,0),1000000))
      limit greatest(1,least(coalesce(p_limit,72),72))
  ) select jsonb_build_object('total',(select count(*) from eligible),'items',coalesce((
    select jsonb_agg(jsonb_build_object('binderKey',case when coalesce(p_stable,true) then binder_key else null end,
      'license',license,'total',total,'owned',0,'percent',0,'favorite',false)
      order by lower(license) collate "C",binder_key) from page),'[]')) into result;
  return result;
end; $$;
revoke all on function public.get_ranking_license_choices(text,text,text,boolean,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_ranking_license_choices(text,text,text,boolean,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
