begin;

create table public.auction_chat_messages (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500 and message = btrim(message)),
  created_at timestamptz not null default clock_timestamp()
);

create index auction_chat_messages_auction_created_idx
  on public.auction_chat_messages(auction_id,created_at desc,id desc);

alter table public.auction_chat_messages enable row level security;
revoke all on table public.auction_chat_messages from public,anon,authenticated;
grant all on table public.auction_chat_messages to service_role;

create function public.get_auction_chat(p_auction_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); sale_status text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select status into sale_status from public.auctions where id=p_auction_id;
  if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  return jsonb_build_object(
    'canPost',sale_status='active' and exists(select 1 from public.bids where auction_id=p_auction_id and bidder_id=player_id),
    'messages',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'userId',m.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,
      'message',m.message,'createdAt',m.created_at,'mine',m.user_id=player_id
    ) order by m.created_at,m.id),'[]'::jsonb)
      from (select * from public.auction_chat_messages where auction_id=p_auction_id
        order by created_at desc,id desc limit 100) m
      join public.user_profiles p on p.user_id=m.user_id)
  );
end; $$;

create function public.send_auction_chat_message(p_auction_id uuid,p_message text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); clean_message text:=btrim(coalesce(p_message,'')); inserted public.auction_chat_messages%rowtype; player public.user_profiles%rowtype;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.auctions where id=p_auction_id) then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  if not exists(select 1 from public.auctions where id=p_auction_id and status='active' and ends_at>clock_timestamp()) then raise exception 'AUCTION_CLOSED' using errcode='P0001'; end if;
  if not exists(select 1 from public.bids where auction_id=p_auction_id and bidder_id=player_id) then raise exception 'CHAT_BIDDERS_ONLY' using errcode='P0001'; end if;
  if char_length(clean_message) not between 1 and 500 then raise exception 'CHAT_MESSAGE_INVALID' using errcode='P0001'; end if;
  insert into public.auction_chat_messages(auction_id,user_id,message)
    values(p_auction_id,player_id,clean_message) returning * into inserted;
  select * into player from public.user_profiles where user_id=player_id;
  return jsonb_build_object('id',inserted.id,'userId',player_id,'pseudo',player.pseudo,'avatarUrl',player.avatar_url,
    'message',inserted.message,'createdAt',inserted.created_at,'mine',true);
end; $$;

revoke all on function public.get_auction_chat(uuid),public.send_auction_chat_message(uuid,text) from public,anon,authenticated;
grant execute on function public.get_auction_chat(uuid),public.send_auction_chat_message(uuid,text) to authenticated;

commit;
