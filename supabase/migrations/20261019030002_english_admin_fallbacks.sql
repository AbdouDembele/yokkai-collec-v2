-- ENG-01: English display fallbacks only; existing signatures and grants are preserved.
begin;

create or replace function public.admin_list_players(p_query text default '', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare clean_query text := left(btrim(coalesce(p_query,'')),100); safe_limit integer := least(greatest(coalesce(p_limit,50),1),100); safe_offset integer := greatest(coalesce(p_offset,0),0);
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  return jsonb_build_object(
    'total',(select count(*) from auth.users u left join public.user_profiles p on p.user_id=u.id where clean_query='' or coalesce(p.pseudo,'') ilike '%'||clean_query||'%' or coalesce(u.email,'') ilike '%'||clean_query||'%'),
    'players',coalesce((select jsonb_agg(jsonb_build_object(
      'userId',listed.id,'pseudo',listed.pseudo,'email',listed.email,'createdAt',listed.created_at,
      'lastSeenAt',listed.last_seen_at,'cardsCount',listed.cards_count,'karasBalance',listed.karas_balance,
      'isBanned',listed.banned_until is not null and listed.banned_until>now(),'isAdmin',listed.is_admin
    ) order by listed.created_at desc) from (
      select u.id,coalesce(p.pseudo,split_part(coalesce(u.email,'Player'),'@',1),'Player') pseudo,coalesce(u.email,'') email,u.created_at,p.last_seen_at,coalesce(p.karas_balance,0) karas_balance,u.banned_until,
        exists(select 1 from public.admin_users au where au.user_id=u.id) is_admin,
        (select count(*) from public.user_cards uc where uc.user_id=u.id) cards_count
      from auth.users u left join public.user_profiles p on p.user_id=u.id
      where clean_query='' or coalesce(p.pseudo,'') ilike '%'||clean_query||'%' or coalesce(u.email,'') ilike '%'||clean_query||'%'
      order by u.created_at desc limit safe_limit offset safe_offset
    ) listed),'[]'::jsonb)
  );
end; $$;

create or replace function public.admin_get_player(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  select jsonb_build_object(
    'userId',u.id,'pseudo',coalesce(p.pseudo,split_part(coalesce(u.email,'Player'),'@',1),'Player'),'email',coalesce(u.email,''),'createdAt',u.created_at,'lastSeenAt',p.last_seen_at,
    'cardsCount',(select count(*) from public.user_cards uc where uc.user_id=u.id),'karasBalance',coalesce(p.karas_balance,0),
    'isBanned',u.banned_until is not null and u.banned_until>now(),
    'isAdmin',exists(select 1 from public.admin_users au where au.user_id=u.id),
    'cards',coalesce((select jsonb_agg(jsonb_build_object(
      'instanceId',owned.id,'cardId',card.id,'name',card.nom,'category',card.categorie,'franchise',card.franchise,
      'rarity',owned.rarity,'imageUrl',coalesce(owned.custom_image_url,card.image_url),'catalogueImage',card.image_url,
      'customImageUrl',owned.custom_image_url,'obtainedAt',owned.date_obtention,'shiny',owned.is_shiny,
      'evolved',owned.is_evolved,'firstOwner',owned.is_first_owner,'locked',owned.is_locked,
      'activeAuctionId',(select auction.id from public.auctions auction where auction.card_instance_id=owned.id and auction.status='active' limit 1)
    ) order by owned.date_obtention desc) from public.user_cards owned join public.cards card on card.id=owned.card_id where owned.user_id=u.id),'[]'::jsonb)
  ) into result from auth.users u left join public.user_profiles p on p.user_id=u.id where u.id=p_user_id;
  if result is null then raise exception 'PLAYER_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;

create or replace function public.admin_search_reports(p_status text default null,p_query text default '',p_limit integer default 30,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  query text:=left(btrim(coalesce(p_query,'')),100);
  safe_limit integer:=least(greatest(coalesce(p_limit,30),1),100);
  safe_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is not null and p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  return (
    with matching as (
      select r.*,case when r.reporter_id is null then 'Deleted player' else coalesce(reporter.pseudo,split_part(coalesce(reporter_auth.email,'Player'),'@',1),'Player') end reporter_pseudo,
        coalesce(reporter_auth.email,'') reporter_email,
        case when r.reported_id is null then 'Deleted player' else coalesce(reported.pseudo,split_part(coalesce(reported_auth.email,'Player'),'@',1),'Player') end reported_pseudo,
        coalesce(reported_auth.email,'') reported_email,
        reported_auth.banned_until is not null and reported_auth.banned_until>now() reported_is_banned
      from public.user_reports r
      left join auth.users reporter_auth on reporter_auth.id=r.reporter_id
      left join auth.users reported_auth on reported_auth.id=r.reported_id
      left join public.user_profiles reporter on reporter.user_id=r.reporter_id
      left join public.user_profiles reported on reported.user_id=r.reported_id
      where (p_status is null or r.status=p_status) and (query='' or
        reporter.pseudo ilike '%'||query||'%' or reporter_auth.email ilike '%'||query||'%' or
        reported.pseudo ilike '%'||query||'%' or reported_auth.email ilike '%'||query||'%')
    ), page as (
      select * from matching order by created_at desc,id desc limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'total',(select count(*) from matching),
      'reports',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'reporterId',reporter_id,'reporterPseudo',reporter_pseudo,'reporterEmail',reporter_email,
        'reportedId',reported_id,'reportedPseudo',reported_pseudo,'reportedEmail',reported_email,'reportedIsBanned',reported_is_banned,
        'reason',reason,'contextType',context_type,'contextId',context_id,'snapshot',snapshot,'details',details,'status',status,'createdAt',created_at
      ) order by created_at desc,id desc) from page),'[]'::jsonb)
    )
  );
end; $$;

create or replace function public.admin_search_card_reports(p_status text default null,p_query text default '',p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  query text:=left(btrim(coalesce(p_query,'')),100);
  safe_limit integer:=least(greatest(coalesce(p_limit,100),1),100);
  safe_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is not null and p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  return (
    with matching as (
      select r.*,case when r.reporter_id is null then 'Deleted player' else coalesce(reporter.pseudo,split_part(coalesce(reporter_auth.email,'Player'),'@',1),'Player') end reporter_pseudo,
        coalesce(reporter_auth.email,'') reporter_email,c.nom card_name,c.franchise,c.image_url,c.rarete_base
      from public.card_reports r
      left join auth.users reporter_auth on reporter_auth.id=r.reporter_id
      left join public.user_profiles reporter on reporter.user_id=r.reporter_id
      left join public.cards c on c.id=r.card_id
      where (p_status is null or r.status=p_status) and (query='' or
        reporter.pseudo ilike '%'||query||'%' or reporter_auth.email ilike '%'||query||'%' or
        c.nom ilike '%'||query||'%' or c.franchise ilike '%'||query||'%')
    ), page as (
      select * from matching order by created_at desc,id desc limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'total',(select count(*) from matching),
      'reports',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'reporterId',reporter_id,'reporterPseudo',reporter_pseudo,'reporterEmail',reporter_email,
        'cardId',card_id,'cardName',coalesce(card_name,snapshot->>'name','Deleted card'),
        'franchise',coalesce(franchise,snapshot->>'franchise',''),'imageUrl',coalesce(image_url,snapshot->>'imageUrl',''),
        'rarity',coalesce(rarete_base::text,snapshot->>'rarity',''),'reason',reason,'snapshot',snapshot,
        'status',status,'createdAt',created_at
      ) order by created_at desc,id desc) from page),'[]'::jsonb)
    )
  );
end; $$;

commit;
