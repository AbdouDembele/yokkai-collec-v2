begin;set local lock_timeout='3s';
create or replace view public.catalogue_binder_links_unmerged as SELECT c.id AS card_id,
    c.categorie AS category,
    l.franchise AS source_license,
        CASE
            WHEN target.id IS NOT NULL THEN 'series:'::text || target.id::text
            ELSE 'source:'::text || encode(sha256(convert_to((c.categorie || chr(31)) || l.franchise, 'UTF8'::name)), 'hex'::text)
        END AS binder_key,
    COALESCE(
        CASE
            WHEN settings.license_grouping_enabled THEN licensed.display_name
            ELSE NULL::text
        END, b.display_name, l.franchise) AS display_name,
        CASE
            WHEN target.id IS NOT NULL THEN 'series'::text
            ELSE 'source'::text
        END AS origin,
    target.id AS series_binder_id
   FROM cards c
     JOIN card_franchises l ON l.card_id = c.id
     LEFT JOIN anime_series_settings settings ON settings.singleton AND settings.enabled
     LEFT JOIN anime_license_source_rules license_rule ON settings.license_grouping_enabled AND c.categorie = 'ANIME/MANGA'::text AND license_rule.source_license = l.franchise
     LEFT JOIN anime_series_protected_cards protected ON protected.card_id = c.id
     LEFT JOIN anime_series_card_assignments a ON settings.singleton AND (settings.license_grouping_enabled OR protected.card_id IS NULL) AND a.card_id = c.id AND a.source_license = l.franchise AND l."position" = 0 AND c.franchise = l.franchise AND c.source = 'anilist'::text AND c.categorie = 'ANIME/MANGA'::text
     LEFT JOIN LATERAL ( SELECT r.binder_id AS prior_id,
            n.binder_id AS license_id,
            COALESCE(n.enforce_separation, false) AS separate
           FROM anime_series_origin_evidence e
             JOIN anime_series_media_rules r ON r.media_id = e.media_id AND r.decision = 'A'::text AND r.editorial_approved
             LEFT JOIN anime_license_media_rules n ON n.media_id = e.media_id
          WHERE a.card_id IS NOT NULL AND e.card_id = a.card_id AND e.media_id = a.media_id AND c.source_id = e.character_id::text AND (NOT settings.license_grouping_enabled OR license_rule.binder_id IS NULL OR (EXISTS ( SELECT 1
                   FROM anime_license_media_rules exception
                  WHERE exception.media_id = a.media_id AND exception.enforce_separation))) AND (e.verified_snapshot - 'favoris_count'::text) = (to_jsonb(c.*) - 'favoris_count'::text)
         LIMIT 1) proof ON true
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN settings.license_grouping_enabled THEN COALESCE(
                    CASE
                        WHEN proof.separate THEN proof.license_id
                        ELSE NULL::uuid
                    END, license_rule.binder_id, proof.license_id, proof.prior_id)
                    ELSE proof.prior_id
                END AS id) target
     LEFT JOIN anime_series_binders b ON b.id = target.id
     LEFT JOIN anime_license_binders licensed ON licensed.id = target.id;;
CREATE OR REPLACE FUNCTION public.get_binder_albums_page(p_owner_id uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text, p_category text DEFAULT ''::text, p_favorites_only boolean DEFAULT false, p_offset integer DEFAULT 0, p_limit integer DEFAULT 72)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare viewer uuid:=auth.uid();owner_id uuid:=coalesce(p_owner_id,auth.uid());
begin
  if viewer is null then raise exception 'AUTH_REQUIRED';end if;
  if not public.can_view_collection(viewer,owner_id) then raise exception 'PROFILE_PRIVATE';end if;
  return (
    with settings as materialized (
      select s.*,s.enabled and s.license_grouping_enabled as licensed from public.anime_series_settings s where singleton
    ), filters as materialized (select public.card_filter_values(upper(coalesce(p_category,''))) categories),
    terms as materialized (
      select term from regexp_split_to_table(lower(btrim(coalesce(p_query,''))),'[[:space:]]+') term where term<>''
    ), catalogue as materialized (
      select distinct l.* from public.catalogue_binder_links l
      where cardinality((select categories from filters))=0
        or upper(btrim(l.category))=any(((select categories from filters))::text[])
    ), owned as materialized (select distinct card_id from public.user_cards where user_id=owner_id),
    stats as materialized (
      select l.binder_key,min(l.display_name) as license,min(l.origin) as origin,min(l.category) as category,
        count(distinct l.card_id)::integer as total,count(distinct o.card_id)::integer as owned
      from catalogue l left join owned o on o.card_id=l.card_id group by l.binder_key
    ), names as materialized (
      select distinct source_license,display_name,binder_key,series_binder_id from catalogue
    ), pending as materialized (
      select f.license from public.panini_album_favorites f where f.user_id=owner_id and not exists (
        select 1 from public.binder_legacy_favorite_resolutions r where r.user_id=owner_id and r.license=f.license
      )
    ), configured as materialized (
      select f.license,'series:' || r.binder_id::text as target_key
      from pending f join public.anime_license_source_rules r on r.source_license=f.license
      where (select licensed from settings)
    ), unresolved as materialized (
      select f.license from pending f where not exists(select 1 from configured c where c.license=f.license)
    ), raw_targets as materialized (
      select * from configured
      union select f.license,n.binder_key from unresolved f join names n on n.source_license=f.license
      union select f.license,n.binder_key from unresolved f join names n on n.display_name=f.license
      union select f.license,n.binder_key from unresolved f join public.active_binder_aliases a on a.alias=f.license
        join names n on n.series_binder_id=a.binder_id where (select licensed from settings)
    ), targets as materialized (
      select distinct license,public.canonical_binder_key(target_key) as target_key from raw_targets
    ), candidates as materialized (
      select t.license,min(t.target_key) as key,count(*) as targets from targets t group by t.license
    ), legacy as materialized (select distinct c.key from candidates c where c.targets=1),
    preferences as materialized (
      select public.canonical_binder_key(p.binder_key) as key,p.binder_key as original,p.favorite,p.license_favorite
      from public.binder_favorite_preferences p where p.user_id=owner_id
    ), folded as materialized (
      select p.key,bool_or(p.favorite) as prior_favorite,
        bool_or(p.license_favorite) filter(where p.original=p.key) as direct_choice,
        bool_or(p.license_favorite) as redirected_choice from preferences p group by p.key
    ), favorite_keys as materialized (
      select k.key from (select key from folded union select key from legacy) k
      left join folded p on p.key=k.key left join legacy l on l.key=k.key
      where case when (select licensed from settings)
        then coalesce(p.direct_choice,p.redirected_choice,coalesce(p.prior_favorite,false) or l.key is not null)
        else coalesce(p.prior_favorite,false) or (p.key is null and l.key is not null) end
    ), conflicts as (
      select c.license,jsonb_agg(jsonb_build_object('binderKey',c.binder_key,'license',c.license_name,
        'origin',c.origin,'category',c.category,'total',c.total) order by c.license_name,c.binder_key) as candidates
      from (select t.license,s.license as license_name,s.binder_key,s.origin,s.category,s.total
        from targets t join stats s on s.binder_key=t.target_key) c
      group by c.license having count(*)>1
    ), searchable as materialized (
      select n.binder_key,string_agg(distinct n.display_name || chr(31) || n.source_license,chr(31)) as names
      from names n where exists(select 1 from terms) group by n.binder_key
    ), alias_names as materialized (
      select 'series:' || a.binder_id::text as binder_key,string_agg(a.alias,chr(31)) as names
      from public.active_binder_aliases a where exists(select 1 from terms) group by a.binder_id
    ), progress as materialized (
      select s.*,coalesce(pop.favorite_count,0) as popularity,exists(select 1 from favorite_keys f where f.key=s.binder_key) as favorite
      from stats s left join (select * from public.binder_popularity_counts('stable') where viewer=owner_id) pop using(binder_key) left join searchable n using(binder_key) left join alias_names a using(binder_key)
      where (cardinality((select categories from filters))=0 or upper(btrim(s.category))=any(((select categories from filters))::text[]))
        and not exists(select 1 from terms t where not (n.names ilike '%' || t.term || '%' or coalesce(a.names ilike '%' || t.term || '%',false)))
    ), filtered as materialized (select * from progress where not coalesce(p_favorites_only,false) or favorite),
    page as (select * from filtered order by favorite desc,popularity desc,owned::numeric/nullif(total,0) desc,owned desc,license,binder_key
      offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,72),1),72))
     , covers as materialized (
          select distinct on (l.binder_key) l.binder_key,c.image_url as image
          from catalogue l join page p using(binder_key) join public.cards c on c.id=l.card_id
          where nullif(btrim(c.image_url),'') is not null
          order by l.binder_key,
            case c.rarete_base when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,c.id
        )
        select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('binderKey',binder_key,
          'image',(select image from covers where covers.binder_key=page.binder_key),
      'license',license,'origin',origin,'total',total,'owned',owned,'favorite',favorite,
      'percent',least(100,round(owned::numeric*100/nullif(total,0))))
      order by favorite desc,popularity desc,owned::numeric/nullif(total,0) desc,owned desc,license,binder_key) from page),'[]'::jsonb),
      'total',(select count(*) from filtered),
      'favoriteConflicts',case when viewer=owner_id then coalesce((select jsonb_agg(to_jsonb(c) order by license) from conflicts c),'[]'::jsonb) else '[]'::jsonb end,
      'mappingVersion',(select mapping_version || ':' || enabled::text || ':' || license_grouping_enabled::text || ':' || license_mapping_version from settings))
  );
end $function$;

CREATE OR REPLACE FUNCTION public.get_ranking_license_choices(p_query text DEFAULT ''::text, p_category text DEFAULT ''::text, p_prefix text DEFAULT ''::text, p_stable boolean DEFAULT true, p_offset integer DEFAULT 0, p_limit integer DEFAULT 72)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end; $function$;

CREATE OR REPLACE FUNCTION public.get_license_leaderboard(p_binder_key text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 20, p_query text DEFAULT ''::text, p_friends_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer uuid:=auth.uid(); result jsonb;
  page_offset integer:=greatest(0,least(coalesce(p_offset,0),1000000));
  page_size integer:=greatest(1,least(coalesce(p_limit,20),100));
  search_query text:=left(btrim(coalesce(p_query,'')),64);
  friends_only boolean:=coalesce(p_friends_only,false);
  chosen text:=public.canonical_binder_key(left(btrim(coalesce(p_binder_key,'')),500));
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.assert_player_not_banned();
  if not exists(select 1 from public.user_profiles where user_id=viewer)
    or exists(select 1 from public.account_deletion_log where user_id=viewer)
    then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;
  if chosen='' then raise exception 'BINDER_KEY_REQUIRED'; end if;
  -- BEGIN PROGRESS_SCORE_V2
  if chosen in ('global:progress-score','global:progress-score:legacy') then
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
      -- Every currently owned catalogue identity earns points, completed or not.
      -- owned is already distinct: aliases, duplicate copies and variants add no bonus.
      select user_id,card_id from owned
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
      'metric','completion-score','scoreVersion',2,
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
    return public.with_leaderboard_history(result,'licenses:progress-score:v2'||case when chosen like '%:legacy' then ':legacy' else '' end);
  end if;
  -- END PROGRESS_SCORE_V2

  -- BEGIN COMPLETION_SCORE_V1
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

  if chosen in ('global:overall','global:overall:legacy','global:completed','global:cards','global:completed:legacy','global:cards:legacy') then
    with catalogue as materialized (
      select distinct l.card_id,l.binder_key from public.catalogue_binder_links l
      where chosen not like '%:legacy'
      union all
      select l.card_id,l.franchise from public.card_franchises l where chosen like '%:legacy'
    ), binder_totals as materialized (
      select binder_key,count(distinct card_id)::bigint as total from catalogue group by binder_key
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
      select o.user_id,c.binder_key,count(distinct o.card_id)::bigint as owned
      from owned o join catalogue c on c.card_id=o.card_id group by o.user_id,c.binder_key
    ), completed as materialized (
      select p.user_id,count(*)::bigint as completed_licenses
      from progress p join binder_totals b on b.binder_key=p.binder_key and p.owned=b.total
      group by p.user_id
    ), card_counts as materialized (
      select user_id,count(*)::bigint as distinct_cards from owned group by user_id
    ), counts as materialized (
      select p.*,coalesce(c.completed_licenses,0)::bigint as completed_licenses,
        coalesce(o.distinct_cards,0)::bigint as distinct_cards,
        case when chosen like 'global:completed%' or chosen like 'global:overall%' then coalesce(c.completed_licenses,0)
          else coalesce(o.distinct_cards,0) end::bigint as value
      from players p left join completed c on c.user_id=p.user_id
      left join card_counts o on o.user_id=p.user_id
    ), ranked as materialized (
      select counts.*,rank() over(order by value desc,case when chosen like 'global:overall%' then distinct_cards else 0 end desc) position,
        row_number() over(order by value desc,distinct_cards desc,lower(pseudo),user_id) global_order
      from counts where is_public and distinct_cards>0
    ), visible as materialized (
      select * from ranked r where not public.users_blocked(viewer,r.user_id)
        and (not friends_only or r.is_friend or r.user_id=viewer)
    ), eligible as materialized (
      select * from visible where
        (search_query<>'' and strpos(lower(pseudo),lower(search_query))>0)
        or (search_query='' and (friends_only or global_order<=100))
    ), page as materialized (
      select * from eligible order by value desc,distinct_cards desc,lower(pseudo),user_id offset page_offset limit page_size
    )
    select jsonb_build_object(
      'offset',page_offset,'limit',page_size,'query',search_query,'friendsOnly',friends_only,'topLimit',100,
      'total',(select count(*) from eligible),'rankedPlayers',(select count(*) from ranked),'binder',null,
      'metric',case when chosen like 'global:overall%' then 'overall' when chosen like 'global:completed%' then 'completed' else 'cards' end,
      'catalogue',jsonb_build_object('totalCards',(select count(*) from public.cards),'totalLicenses',(select count(*) from binder_totals)),
      'entries',coalesce((select jsonb_agg(jsonb_build_object(
        'userId',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'position',position,'value',value,'isFriend',is_friend,
        'completedLicenses',completed_licenses,'distinctCards',distinct_cards
      ) order by value desc,distinct_cards desc,lower(pseudo),user_id) from page),'[]'::jsonb),
      'mine',(select jsonb_build_object('value',value,'isPublic',is_public,'completedLicenses',completed_licenses,
        'distinctCards',distinct_cards,'position',(select position from ranked where user_id=viewer)) from counts where user_id=viewer),
      'profileStyles',coalesce((select jsonb_object_agg(user_id,public.billing_profile_cosmetics(user_id)) from page),'{}'::jsonb)
    ) into result;
    result := public.with_leaderboard_history(result,'licenses:' || chosen); return result;
  end if;

  with members as materialized (
    -- Stable keys distinguish homonymous categories; legacy names remain supported
    -- only when the client uses legacy binders. Both include secondary licenses.
    select distinct l.card_id,l.display_name as license from public.catalogue_binder_links l
      where chosen ~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' and l.binder_key=chosen
    union all
    select c.card_id,c.franchise from public.card_franchises c
      where chosen !~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' and c.franchise=chosen
  ), binder as materialized (
    select chosen as key,min(license) as license,count(distinct card_id)::integer as total from members
  ), holdings as materialized (
    -- Current distinct catalogue identities, independent of duplicates/variants.
    select uc.user_id,count(distinct uc.card_id)::integer as value
    from public.user_cards uc join (select distinct card_id from members) m on m.card_id=uc.card_id
    group by uc.user_id
  ), players as materialized (
    select p.user_id,p.pseudo,p.avatar_url,p.is_public,
      exists(select 1 from public.friendships f where f.status='accepted' and
        ((f.user_id=viewer and f.friend_id=p.user_id) or (f.friend_id=viewer and f.user_id=p.user_id))) is_friend
    from public.user_profiles p join auth.users u on u.id=p.user_id
    where (p.is_public or p.user_id=viewer)
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
      and not exists(select 1 from public.account_deletion_log d where d.user_id=p.user_id)
  ), counts as materialized (
    select p.*,coalesce(h.value,0)::bigint as value from players p
    left join holdings h on h.user_id=p.user_id
  ), ranked as materialized (
    -- Competition ranks retain ties; alphabetical order only stabilizes display.
    select counts.*,rank() over(order by value desc) position,
      row_number() over(order by value desc,lower(pseudo),user_id) global_order
    from counts where is_public and value>0
  ), visible as materialized (
    select * from ranked r where not public.users_blocked(viewer,r.user_id)
      and (not friends_only or r.is_friend or r.user_id=viewer)
  ), eligible as materialized (
    select * from visible where
      (search_query<>'' and strpos(lower(pseudo),lower(search_query))>0)
      or (search_query='' and (friends_only or global_order<=100))
  ), page as materialized (
    select * from eligible order by value desc,lower(pseudo),user_id offset page_offset limit page_size
  )
  select jsonb_build_object(
    'offset',page_offset,'limit',page_size,'query',search_query,'friendsOnly',friends_only,'topLimit',100,
    'total',(select count(*) from eligible),'rankedPlayers',(select count(*) from ranked),
    'binder',(select jsonb_build_object('key',key,'license',license,'total',total) from binder),
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'position',position,'value',value,'isFriend',is_friend
    ) order by value desc,lower(pseudo),user_id) from page),'[]'::jsonb),
    'mine',(select jsonb_build_object('value',value,'isPublic',is_public,
      'position',(select position from ranked where user_id=viewer)) from counts where user_id=viewer),
    'profileStyles',coalesce((select jsonb_object_agg(user_id,public.billing_profile_cosmetics(user_id)) from page),'{}'::jsonb)
  ) into result;
  result := public.with_leaderboard_history(result,'licenses:' || chosen); return result;
end; $function$;

CREATE OR REPLACE FUNCTION public.with_leaderboard_history(p_result jsonb, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end; $function$;
notify pgrst,'reload schema';commit;
