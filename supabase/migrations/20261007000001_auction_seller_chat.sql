begin;

create or replace function public.get_auction_chat(p_auction_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); sale public.auctions%rowtype;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select * into sale from public.auctions where id=p_auction_id;
  if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  return jsonb_build_object(
    'canPost',sale.status='active' and (sale.seller_id=player_id or exists(select 1 from public.bids where auction_id=p_auction_id and bidder_id=player_id)),
    'participants',(select coalesce(jsonb_agg(jsonb_build_object(
      'userId',participants.user_id,'pseudo',participants.pseudo,'avatarUrl',participants.avatar_url,
      'mine',participants.user_id=player_id
    ) order by lower(participants.pseudo),participants.user_id),'[]'::jsonb)
      from (select p.user_id,p.pseudo,p.avatar_url from public.user_profiles p where p.user_id=sale.seller_id
        union
        select p.user_id,p.pseudo,p.avatar_url from public.bids b join public.user_profiles p on p.user_id=b.bidder_id
        where b.auction_id=p_auction_id) participants),
    'messages',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'userId',m.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url,
      'message',m.message,'createdAt',m.created_at,'mine',m.user_id=player_id
    ) order by m.created_at,m.id),'[]'::jsonb)
      from (select * from public.auction_chat_messages where auction_id=p_auction_id
        order by created_at desc,id desc limit 100) m
      join public.user_profiles p on p.user_id=m.user_id)
  );
end; $$;

create or replace function public.send_auction_chat_message(p_auction_id uuid,p_message text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  player_id uuid:=auth.uid();
  clean_message text:=btrim(coalesce(p_message,''));
  sale public.auctions%rowtype;
  inserted public.auction_chat_messages%rowtype;
  player public.user_profiles%rowtype;
  mentioned_pseudo text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select * into sale from public.auctions where id=p_auction_id;
  if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  if sale.status<>'active' or sale.ends_at<=clock_timestamp() then raise exception 'AUCTION_CLOSED' using errcode='P0001'; end if;
  if sale.seller_id<>player_id and not exists(select 1 from public.bids where auction_id=p_auction_id and bidder_id=player_id) then raise exception 'CHAT_PARTICIPANTS_ONLY' using errcode='P0001'; end if;
  if char_length(clean_message) not between 1 and 500 then raise exception 'CHAT_MESSAGE_INVALID' using errcode='P0001'; end if;

  for mentioned_pseudo in
    select distinct match[1] from regexp_matches(clean_message,'@([[:alnum:]_.-]{3,30})','g') match
  loop
    if not exists(
      select 1 from public.user_profiles p
      where lower(p.pseudo)=lower(mentioned_pseudo) and (p.user_id=sale.seller_id or exists(
        select 1 from public.bids b where b.auction_id=p_auction_id and b.bidder_id=p.user_id
      ))
    ) then raise exception 'CHAT_MENTION_INVALID' using errcode='P0001'; end if;
  end loop;

  insert into public.auction_chat_messages(auction_id,user_id,message)
    values(p_auction_id,player_id,clean_message) returning * into inserted;
  insert into public.notifications(user_id,type,reference_id,actor_user_id)
  select distinct p.user_id,'auction_chat_mention',p_auction_id,player_id
  from regexp_matches(clean_message,'@([[:alnum:]_.-]{3,30})','g') match
  join public.user_profiles p on lower(p.pseudo)=lower(match[1])
  where p.user_id<>player_id and (p.user_id=sale.seller_id or exists(
    select 1 from public.bids b where b.auction_id=p_auction_id and b.bidder_id=p.user_id
  ))
  on conflict (user_id,type,reference_id) do update
    set actor_user_id=excluded.actor_user_id,read_at=null,created_at=clock_timestamp();

  select * into player from public.user_profiles where user_id=player_id;
  return jsonb_build_object('id',inserted.id,'userId',player_id,'pseudo',player.pseudo,'avatarUrl',player.avatar_url,
    'message',inserted.message,'createdAt',inserted.created_at,'mine',true);
end; $$;

commit;
