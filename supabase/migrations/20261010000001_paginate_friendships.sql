begin;

create function public.get_friendships_page(p_cursor jsonb default null,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); page_size integer:=least(p_limit,100);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_limit is null or p_limit<1 then raise exception 'INVALID_PAGE_SIZE' using errcode='P0001'; end if;
  return (with candidates as (
    select f.id,f.created_at,p.user_id,p.pseudo,p.avatar_url,p.last_seen_at,p.presence_active,
      case when f.status='accepted' then 0 when f.friend_id=player_id then 1 else 2 end sort_kind,
      case when f.status='accepted' then lower(p.pseudo) else '' end sort_name,
      case when f.status='accepted' then '-infinity'::timestamptz else f.created_at end sort_at
    from public.friendships f
    join public.user_profiles p on p.user_id=case when f.user_id=player_id then f.friend_id else f.user_id end
    where f.status in ('accepted','pending') and (f.user_id=player_id or f.friend_id=player_id)
  ), selected as materialized (
    select * from candidates
    where p_cursor is null or (sort_kind,sort_name,sort_at,id)>
      ((p_cursor->>'kind')::integer,p_cursor->>'name',(p_cursor->>'sortAt')::timestamptz,(p_cursor->>'id')::uuid)
    -- Exactly the existing database collation and per-bucket ordering.
    order by sort_kind,sort_name,sort_at,id limit page_size
  ) select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'bucket',case sort_kind when 0 then 'friends' when 1 then 'incoming' else 'outgoing' end,
      'friend',case when sort_kind=0 then jsonb_build_object(
        'id',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'lastSeenAt',last_seen_at,
        'isOnline',coalesce(presence_active and last_seen_at>=statement_timestamp()-interval '10 minutes',false)
      ) else jsonb_build_object('requestId',id,'id',user_id,'pseudo',pseudo,'avatarUrl',avatar_url,'createdAt',created_at) end
    ) order by sort_kind,sort_name,sort_at,id),'[]'::jsonb),
    'nextCursor',case when count(*)=page_size then jsonb_agg(jsonb_build_object(
      'kind',sort_kind,'name',sort_name,'sortAt',sort_at,'id',id
    ) order by sort_kind desc,sort_name desc,sort_at desc,id desc)->0 end
  ) from selected);
end; $$;

revoke all on function public.get_friendships_page(jsonb,integer) from public,anon,authenticated;
grant execute on function public.get_friendships_page(jsonb,integer) to authenticated;

commit;
