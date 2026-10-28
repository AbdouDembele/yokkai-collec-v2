begin;

-- Production has 30 messages (2026-10-13); ordinary index creation is sufficient.
create index auction_chat_messages_user_created_idx
  on public.auction_chat_messages(user_id,created_at desc);

create or replace function public.send_auction_chat_message(p_auction_id uuid,p_message text,p_gif_url text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); clean_message text:=btrim(coalesce(p_message,'')); clean_gif text:=nullif(btrim(coalesce(p_gif_url,'')),''); sale public.auctions%rowtype; inserted public.auction_chat_messages%rowtype; player public.user_profiles%rowtype; mentioned_pseudo text; sent_at timestamptz; recent_count integer; oldest_recent timestamptz; latest_recent timestamptz; retry_seconds integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select * into sale from public.auctions where id=p_auction_id;
  if not found then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  if sale.status<>'active' or sale.ends_at<=clock_timestamp() then raise exception 'AUCTION_CLOSED' using errcode='P0001'; end if;
  if sale.seller_id<>player_id and not exists(select 1 from public.bids where auction_id=p_auction_id and bidder_id=player_id) then raise exception 'CHAT_PARTICIPANTS_ONLY' using errcode='P0001'; end if;
  if clean_gif is null and char_length(clean_message) not between 1 and 500 then raise exception 'CHAT_MESSAGE_INVALID' using errcode='P0001'; end if;
  if clean_gif is not null and (char_length(clean_gif)>1000 or clean_gif!~'^https://(media[0-9]*|i)\.giphy\.com/') then raise exception 'CHAT_GIF_INVALID' using errcode='P0001'; end if;
  if clean_gif is not null then clean_message:='GIF'; end if;
  for mentioned_pseudo in select distinct lower(match[1]) from regexp_matches(clean_message,'@([[:alnum:]_.-]{3,30})','g') match loop
    if not exists(select 1 from public.user_profiles p where lower(p.pseudo)=lower(mentioned_pseudo) and (p.user_id=sale.seller_id or exists(select 1 from public.bids b where b.auction_id=p_auction_id and b.bidder_id=p.user_id))) then raise exception 'CHAT_MENTION_INVALID' using errcode='P0001'; end if;
  end loop;
  if (select count(distinct lower(match[1])) from regexp_matches(clean_message,'@([[:alnum:]_.-]{3,30})','g') match)>3 then
    raise exception 'CHAT_MENTION_INVALID' using errcode='P0001',detail='max_mentions=3';
  end if;
  -- Dedicated two-int chat namespace; other application locks use one bigint.
  perform pg_catalog.pg_advisory_xact_lock(1128808788,pg_catalog.hashtext(player_id::text));
  sent_at:=clock_timestamp();
  select count(*),min(created_at),max(created_at) into recent_count,oldest_recent,latest_recent
    from (select created_at from public.auction_chat_messages
      where user_id=player_id and created_at>sent_at-interval '60 seconds'
      order by created_at desc limit 10) recent;
  retry_seconds:=ceil(greatest(
    coalesce(extract(epoch from latest_recent+interval '3 seconds'-sent_at),0),
    case when recent_count>=10 then extract(epoch from oldest_recent+interval '60 seconds'-sent_at) else 0 end
  ))::integer;
  if retry_seconds>0 then
    raise exception 'CHAT_RATE_LIMITED' using errcode='P0001',detail=retry_seconds::text;
  end if;
  insert into public.auction_chat_messages(auction_id,user_id,message,gif_url,created_at)
    values(p_auction_id,player_id,clean_message,clean_gif,sent_at) returning * into inserted;
  insert into public.notifications as existing(user_id,type,reference_id,actor_user_id,created_at)
  select distinct p.user_id,'auction_chat_mention',p_auction_id,player_id,sent_at from regexp_matches(clean_message,'@([[:alnum:]_.-]{3,30})','g') match join public.user_profiles p on lower(p.pseudo)=lower(match[1])
  where p.user_id<>player_id and not public.users_blocked(p.user_id,player_id) and (p.user_id=sale.seller_id or exists(select 1 from public.bids b where b.auction_id=p_auction_id and b.bidder_id=p.user_id))
  -- Stable recipient order prevents cycles when two authors mention several people.
  order by p.user_id
  on conflict (user_id,type,reference_id) do update
    set actor_user_id=excluded.actor_user_id,read_at=null,created_at=clock_timestamp()
    where existing.read_at is not null and existing.created_at<=clock_timestamp()-interval '10 minutes';
  select * into player from public.user_profiles where user_id=player_id;
  return jsonb_build_object('id',inserted.id,'userId',player_id,'pseudo',player.pseudo,'avatarUrl',player.avatar_url,'message',inserted.message,'gifUrl',inserted.gif_url,'createdAt',inserted.created_at,'mine',true);
end; $$;

commit;
