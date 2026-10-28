begin;

create function public.remove_friend(p_friend_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_friend_id=player_id then raise exception 'FRIENDSHIP_NOT_FOUND' using errcode='P0001'; end if;

  delete from public.friendships
  where status='accepted'
    and ((user_id=player_id and friend_id=p_friend_id)
      or (user_id=p_friend_id and friend_id=player_id));

  if not found then raise exception 'FRIENDSHIP_NOT_FOUND' using errcode='P0001'; end if;
  return true;
end; $$;

revoke all on function public.remove_friend(uuid) from public,anon,authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;

commit;
