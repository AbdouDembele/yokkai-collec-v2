begin;
set local lock_timeout='3s';
-- New weighted mode; old global and per-license contracts remain compatible.
do $patch$
declare original text; changed text; marker text:='  if chosen in (''global:overall''';
begin
 original:=pg_get_functiondef('public.get_license_leaderboard(text,integer,integer,text,boolean)'::regprocedure);
 changed:=replace(original,marker,$branch$  -- BEGIN COMPLETION_SCORE_V1
  if chosen in ('global:completion-score','global:completion-score:legacy') then
    with catalogue as materialized (
      select distinct l.card_id,l.binder_key from public.catalogue_binder_links l
        where chosen not like '%:legacy'
      union all
      select distinct l.card_id,l.franchise from public.card_franchises l
        where chosen like '%:legacy'
    ), binder_totals as materialized (
      select binder_key,count(distinct card_id)::bigint total from catalogue group by binder_key
    ), players as materialized (
      select p.user_id,p.pseudo,p.avatar_url,p.is_public,
        exists(select 1 from public.friendships f where f.status='accepted' and
          ((f.user_id=viewer and f.friend_id=p.user_id) or (f.friend_id=viewer and f.user_id=p.user_id))) is_friend
      from public.user_profiles p join auth.users u on u.id=p.user_id
      where (p.is_public or p.user_id=viewer)
        and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
        and not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
    ), owned as materialized (
      select distinct uc.user_id,uc.card_id from public.user_cards uc
        join players p on p.user_id=uc.user_id join public.cards c on c.id=uc.card_id
    ), progress as materialized (
      select o.user_id,c.binder_key,count(distinct o.card_id)::bigint owned
        from owned o join catalogue c on c.card_id=o.card_id group by o.user_id,c.binder_key
    ), completed_binders as materialized (
      select p.user_id,p.binder_key from progress p join binder_totals b using(binder_key)
        where b.total>0 and p.owned=b.total
    ), completed_counts as materialized (
      select user_id,count(*)::bigint completed_licenses from completed_binders group by user_id
    ), scored_cards as materialized (
      -- One catalogue identity earns points once, even in several completed binders.
      select distinct b.user_id,c.card_id from completed_binders b join catalogue c using(binder_key)
    ), scores as materialized (
      select s.user_id,sum(case c.rarete_base::text
        when 'LR' then 15 when 'SSR' then 8 when 'SR' then 4 when 'R' then 2 else 1 end)::bigint completion_score
        from scored_cards s join public.cards c on c.id=s.card_id group by s.user_id
    ), card_counts as materialized (
      select user_id,count(*)::bigint distinct_cards from owned group by user_id
    ), counts as materialized (
      select p.*,coalesce(s.completion_score,0)::bigint completion_score,
        coalesce(c.completed_licenses,0)::bigint completed_licenses,
        coalesce(o.distinct_cards,0)::bigint distinct_cards
      from players p left join completed_counts c using(user_id)
        left join scores s using(user_id) left join card_counts o using(user_id)
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
      'metric','completion-score','scoreVersion',1,
      'completionWeights',jsonb_build_object('C',1,'R',2,'SR',4,'SSR',8,'LR',15),
      'catalogue',jsonb_build_object('totalCards',(select count(*) from public.cards),'totalLicenses',(select count(*) from binder_totals)),
      'entries',coalesce((select jsonb_agg(jsonb_build_object(
        'userId',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'position',position,'value',completion_score,
        'completionScore',completion_score,'completedLicenses',completed_licenses,'distinctCards',distinct_cards,'isFriend',is_friend
      ) order by completion_score desc,completed_licenses desc,lower(pseudo),user_id) from page),'[]'),
      'mine',(select jsonb_build_object('value',completion_score,'completionScore',completion_score,'isPublic',is_public,
        'completedLicenses',completed_licenses,'distinctCards',distinct_cards,'position',(select position from ranked where user_id=viewer))
        from counts where user_id=viewer),
      'profileStyles',coalesce((select jsonb_object_agg(user_id,public.billing_profile_cosmetics(user_id)) from page),'{}')
    ) into result;
    -- A fresh history key prevents comparing this formula with the former ranking.
    return public.with_leaderboard_history(result,'licenses:completion-score:v1'||case when chosen like '%:legacy' then ':legacy' else '' end);
  end if;
  -- END COMPLETION_SCORE_V1

$branch$||marker);
 if changed=original or changed not like '%BEGIN COMPLETION_SCORE_V1%' then raise exception 'COMPLETION_SCORE_PATCH_MISMATCH'; end if;
 execute changed;
end $patch$;
notify pgrst,'reload schema';
commit;
