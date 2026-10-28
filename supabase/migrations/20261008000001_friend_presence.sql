begin;

alter table public.user_profiles
  add column if not exists last_seen_at timestamptz,
  add column if not exists presence_active boolean not null default false;

create or replace function public.touch_presence()
returns timestamptz language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); seen_at timestamptz;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  update public.user_profiles
    set last_seen_at=clock_timestamp(),presence_active=true
    where user_id=player_id
      and (last_seen_at is null or last_seen_at < clock_timestamp()-interval '30 seconds')
    returning last_seen_at into seen_at;
  if seen_at is null then
    select last_seen_at into seen_at from public.user_profiles where user_id=player_id;
  end if;
  return seen_at;
end; $$;

create or replace function public.mark_offline()
returns timestamptz language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); seen_at timestamptz:=clock_timestamp();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  update public.user_profiles set last_seen_at=seen_at,presence_active=false where user_id=player_id;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return seen_at;
end; $$;

create or replace function public.get_friendships()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return jsonb_build_object(
    'friends',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,
        'lastSeenAt',p.last_seen_at,
        'isOnline',coalesce(p.presence_active and p.last_seen_at >= statement_timestamp()-interval '10 minutes',false)
      ) order by lower(p.pseudo)),'[]'::jsonb)
      from public.friendships f join public.user_profiles p on p.user_id=case when f.user_id=player_id then f.friend_id else f.user_id end
      where f.status='accepted' and (f.user_id=player_id or f.friend_id=player_id)),
    'incoming',(select coalesce(jsonb_agg(jsonb_build_object('requestId',f.id,'id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,'createdAt',f.created_at) order by f.created_at),'[]'::jsonb)
      from public.friendships f join public.user_profiles p on p.user_id=f.user_id where f.friend_id=player_id and f.status='pending'),
    'outgoing',(select coalesce(jsonb_agg(jsonb_build_object('requestId',f.id,'id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,'createdAt',f.created_at) order by f.created_at),'[]'::jsonb)
      from public.friendships f join public.user_profiles p on p.user_id=f.friend_id where f.user_id=player_id and f.status='pending'));
end; $$;

revoke all on function public.touch_presence() from public,anon;
grant execute on function public.touch_presence() to authenticated;
revoke all on function public.mark_offline() from public,anon;
grant execute on function public.mark_offline() to authenticated;

commit;
