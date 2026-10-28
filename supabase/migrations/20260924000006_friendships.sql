begin;

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id <> friend_id)
);

create unique index friendships_unique_pair
  on public.friendships (least(user_id,friend_id),greatest(user_id,friend_id));
create index friendships_recipient_idx on public.friendships(friend_id,status);
create index friendships_sender_idx on public.friendships(user_id,status);

alter table public.friendships enable row level security;
revoke all on table public.friendships from public,anon,authenticated;
grant all on table public.friendships to service_role;

create function public.friendship_state(p_viewer uuid,p_other uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce((select case
      when f.status='accepted' then 'accepted'
      when f.user_id=p_viewer then 'outgoing'
      else 'incoming'
    end
    from public.friendships f
    where (f.user_id=p_viewer and f.friend_id=p_other)
       or (f.user_id=p_other and f.friend_id=p_viewer)
    limit 1),'none')
$$;
revoke all on function public.friendship_state(uuid,uuid) from public,anon,authenticated;

create function public.search_users(p_query text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); query text:=btrim(coalesce(p_query,''));
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if length(query)<2 then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.user_id,'pseudo',p.pseudo,'status',public.friendship_state(player_id,p.user_id)
  ) order by lower(p.pseudo),p.user_id),'[]'::jsonb)
  from (select user_id,pseudo from public.user_profiles
    where user_id<>player_id and pseudo ilike '%'||query||'%' limit 20) p);
end; $$;

create function public.get_friendships()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return jsonb_build_object(
    'friends',(select coalesce(jsonb_agg(jsonb_build_object('id',p.user_id,'pseudo',p.pseudo) order by lower(p.pseudo)),'[]'::jsonb)
      from public.friendships f join public.user_profiles p on p.user_id=case when f.user_id=player_id then f.friend_id else f.user_id end
      where f.status='accepted' and (f.user_id=player_id or f.friend_id=player_id)),
    'incoming',(select coalesce(jsonb_agg(jsonb_build_object('requestId',f.id,'id',p.user_id,'pseudo',p.pseudo,'createdAt',f.created_at) order by f.created_at),'[]'::jsonb)
      from public.friendships f join public.user_profiles p on p.user_id=f.user_id
      where f.friend_id=player_id and f.status='pending'),
    'outgoing',(select coalesce(jsonb_agg(jsonb_build_object('requestId',f.id,'id',p.user_id,'pseudo',p.pseudo,'createdAt',f.created_at) order by f.created_at),'[]'::jsonb)
      from public.friendships f join public.user_profiles p on p.user_id=f.friend_id
      where f.user_id=player_id and f.status='pending')
  );
end; $$;

create function public.get_public_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select jsonb_build_object('id',p.user_id,'pseudo',p.pseudo,
    'friendshipStatus',case when p.user_id=player_id then 'self' else public.friendship_state(player_id,p.user_id) end)
    into result from public.user_profiles p where p.user_id=p_user_id;
  if result is null then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;

create function public.send_friend_request(p_friend_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); request_id uuid;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_friend_id=player_id then raise exception 'CANNOT_FRIEND_SELF' using errcode='P0001'; end if;
  if not exists(select 1 from public.user_profiles where user_id=p_friend_id) then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  insert into public.friendships(user_id,friend_id) values(player_id,p_friend_id) returning id into request_id;
  return request_id;
exception when unique_violation then raise exception 'FRIENDSHIP_EXISTS' using errcode='P0001';
end; $$;

create function public.respond_friend_request(p_request_id uuid,p_accept boolean)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_accept then
    update public.friendships set status='accepted',updated_at=clock_timestamp()
      where id=p_request_id and friend_id=player_id and status='pending';
  else
    delete from public.friendships where id=p_request_id and friend_id=player_id and status='pending';
  end if;
  if not found then raise exception 'FRIEND_REQUEST_NOT_FOUND' using errcode='P0001'; end if;
  return p_accept;
end; $$;

revoke all on function public.search_users(text),public.get_friendships(),public.get_public_profile(uuid),
  public.send_friend_request(uuid),public.respond_friend_request(uuid,boolean) from public,anon,authenticated;
grant execute on function public.search_users(text),public.get_friendships(),public.get_public_profile(uuid),
  public.send_friend_request(uuid),public.respond_friend_request(uuid,boolean) to authenticated;

commit;
