begin;

-- Keep the existing interest score, projections, authorization and Market pins.
-- Only the Home's interest mode ignores personal pins before the SQL limit.
do $migration$
declare target regprocedure; definition text; previous text; replacement text;
begin
  target:='public.browse_auctions_page(integer,text,text,text,text,text)'::regprocedure;
  definition:=pg_get_functiondef(target);
  for previous,replacement in select * from (values
    ($old$p_sort not in ('end','asc','desc','popular')$old$,
     $new$p_sort not in ('end','asc','desc','popular','interest')$new$),
    ($old$exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id) watched_first$old$,
     $new$(p_sort<>'interest' and exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)) watched_first$new$),
    ($old$when 'popular' then -a.popularity$old$,
     $new$when 'popular' then -a.popularity when 'interest' then -a.popularity$new$),
    ($old$when p_sort='popular' then a.end_key$old$,
     $new$when p_sort in ('popular','interest') then a.end_key$new$)
  ) edits(previous,replacement) loop
    if array_length(string_to_array(definition,previous),1)<>2 then
      raise exception 'HOME_INTEREST_DEFINITION_CHANGED';
    end if;
    definition:=replace(definition,previous,replacement);
  end loop;
  execute definition;

  -- The legacy full-list API and the cursor API must share the same ordering.
  target:='public.get_friendships()'::regprocedure;
  definition:=pg_get_functiondef(target);
  previous:='order by lower(p.pseudo)';
  if array_length(string_to_array(definition,previous),1)<>2 then
    raise exception 'FRIEND_ACTIVITY_DEFINITION_CHANGED';
  end if;
  execute replace(definition,previous,
    'order by coalesce(p.presence_active and p.last_seen_at>=statement_timestamp()-interval ''10 minutes'',false) desc,p.last_seen_at desc nulls last,lower(p.pseudo),f.id');
end $migration$;

create or replace function public.get_friendships_page(p_cursor jsonb default null,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); page_size integer:=least(p_limit,100);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_limit is null or p_limit<1 then raise exception 'INVALID_PAGE_SIZE' using errcode='P0001'; end if;
  return (with candidates as (
    select f.id,f.created_at,p.user_id,p.pseudo,p.avatar_url,p.last_seen_at,
      coalesce(p.presence_active and p.last_seen_at>=statement_timestamp()-interval '10 minutes',false) is_online,
      case when f.status='accepted' then 0 when f.friend_id=player_id then 1 else 2 end sort_kind,
      case when f.status='accepted' and coalesce(p.presence_active and p.last_seen_at>=statement_timestamp()-interval '10 minutes',false) then 0
        when f.status='accepted' then 1 else 0 end sort_presence,
      case when f.status='accepted' then coalesce(-extract(epoch from p.last_seen_at),1e20) else 0 end sort_seen,
      case when f.status='accepted' then lower(p.pseudo) else '' end sort_name,
      case when f.status='accepted' then '-infinity'::timestamptz else f.created_at end sort_at
    from public.friendships f
    join public.user_profiles p on p.user_id=case when f.user_id=player_id then f.friend_id else f.user_id end
    where f.status in ('accepted','pending') and (f.user_id=player_id or f.friend_id=player_id)
  ), selected as materialized (
    select * from candidates
    -- A cursor issued before this migration restarts the list; the client pager
    -- deduplicates IDs. Keep fractional timestamps as strings in new cursors.
    where p_cursor is null or not (p_cursor ? 'presence') or
      (sort_kind,sort_presence,sort_seen,sort_name,sort_at,id)>
      ((p_cursor->>'kind')::integer,(p_cursor->>'presence')::integer,
       (p_cursor->>'seen')::numeric,p_cursor->>'name',(p_cursor->>'sortAt')::timestamptz,(p_cursor->>'id')::uuid)
    order by sort_kind,sort_presence,sort_seen,sort_name,sort_at,id limit page_size
  ) select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'bucket',case sort_kind when 0 then 'friends' when 1 then 'incoming' else 'outgoing' end,
      'friend',case when sort_kind=0 then jsonb_build_object(
        'id',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'lastSeenAt',last_seen_at,'isOnline',is_online
      ) else jsonb_build_object('requestId',id,'id',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'createdAt',created_at) end
    ) order by sort_kind,sort_presence,sort_seen,sort_name,sort_at,id),'[]'::jsonb),
    'nextCursor',case when count(*)=page_size then jsonb_agg(jsonb_build_object(
      'kind',sort_kind,'presence',sort_presence,'seen',sort_seen::text,'name',sort_name,'sortAt',sort_at,'id',id
    ) order by sort_kind desc,sort_presence desc,sort_seen desc,sort_name desc,sort_at desc,id desc)->0 end
  ) from selected);
end; $$;

-- CREATE OR REPLACE preserves existing authenticated-only ACLs.
notify pgrst, 'reload schema';
commit;
