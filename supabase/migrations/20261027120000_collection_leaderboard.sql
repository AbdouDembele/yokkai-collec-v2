begin;

-- Collection score v1: the first copy of each catalog card + variant is worth
-- 100%, the next four 20% each, then zero. Nothing is awarded historically.
-- Infinity preserves fusion cost +20% (five SSR / three LR); natural LR Shiny
-- is x10. SSR's historical shiny flag is Infinity, never a stacked multiplier.
create function public.get_collection_leaderboard(p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  viewer uuid:=auth.uid(); result jsonb;
  page_offset integer:=greatest(0,least(coalesce(p_offset,0),1000000));
  page_size integer:=greatest(1,least(coalesce(p_limit,20),50));
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.assert_player_not_banned();
  if not exists(select 1 from public.user_profiles where user_id=viewer)
    or exists(select 1 from public.account_deletion_log where user_id=viewer)
    then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;

  with players as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public
    from public.user_profiles p join auth.users u on u.id=p.user_id
    where (p.is_public or p.user_id=viewer)
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
      and not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
  ), variants as materialized (
    select owned.user_id,owned.card_id,c.rarete_base::text rarity,
      case when c.rarete_base='SSR' and (owned.is_evolved or owned.is_shiny) then 'infinity'
        when c.rarete_base='LR' and owned.is_evolved then 'infinity'
        when c.rarete_base='LR' and owned.is_shiny then 'shiny'
        else 'standard' end variant,
      count(*) copies
    from public.user_cards owned join players p on p.user_id=owned.user_id
      join public.cards c on c.id=owned.card_id
    group by owned.user_id,owned.card_id,c.rarete_base,variant
  ), values_per_variant as (
    select variants.*,case
      when rarity='LR' and variant='shiny' then 50000
      when rarity='LR' and variant='infinity' then 18000
      when rarity='SSR' and variant='infinity' then 6000
      when rarity='LR' then 5000 when rarity='SSR' then 1000
      when rarity='SR' then 100 when rarity='R' then 25 else 5 end base_points
    from variants
  ), scored as materialized (
    select values_per_variant.*,base_points*(5+least(copies-1,4))/5 points
    from values_per_variant
  ), totals as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public,
      coalesce(sum(s.points),0)::bigint score,count(s.card_id) unique_variants,
      count(s.card_id) filter(where s.variant='infinity') infinity_variants,
      count(s.card_id) filter(where s.variant='shiny') shiny_variants
    from players p left join scored s on s.user_id=p.user_id
    group by p.user_id,p.pseudo,p.avatar_url,p.is_public
  ), ranked as materialized (
    -- Competition ranking: 1, 2, 2, 4. Display order never breaks a score tie.
    select totals.*,rank() over(order by score desc) position
    from totals where is_public and score>0
  ), visible as materialized (
    select * from ranked r where not public.users_blocked(viewer,r.user_id)
  ), page as (
    select * from visible order by score desc,lower(pseudo),user_id
      offset page_offset limit page_size
  ), breakdown as (
    select rarity,variant,sum(points)::bigint points,count(*) unique_variants,
      sum(copies)::bigint copies,sum(points-base_points)::bigint duplicate_points
    from scored where user_id=viewer group by rarity,variant
  )
  select jsonb_build_object(
    'rulesVersion',1,'offset',page_offset,'limit',page_size,
    'total',(select count(*) from visible),'rankedPlayers',(select count(*) from ranked),
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'position',position,
      'score',score,'uniqueVariants',unique_variants,
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
end; $$;

revoke all on function public.get_collection_leaderboard(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_collection_leaderboard(integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
