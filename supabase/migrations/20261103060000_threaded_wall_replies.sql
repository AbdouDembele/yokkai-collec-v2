begin;
set local lock_timeout='3s';
alter table public.wall_post_replies add column parent_reply_id uuid references public.wall_post_replies(id) on delete set null;
alter table public.wall_post_replies add constraint wall_reply_not_self check(parent_reply_id is distinct from id);
create index wall_reply_parent_idx on public.wall_post_replies(parent_reply_id) where parent_reply_id is not null;
-- Keep all existing notification types; add one targeted comment notification.
do $$ declare definition text; begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_type_check';
 if definition is null then raise exception 'NOTIFICATION_CONSTRAINT_MISSING'; end if;
 alter table public.notifications drop constraint notifications_type_check;
 execute 'alter table public.notifications add constraint notifications_type_check check (type=''wall_reply_received'' or ('||substring(definition from 8 for char_length(definition)-8)||'))';
end $$;

create function public.publish_wall_post_reply_to(p_post_id uuid,p_id uuid,p_parent_id uuid,p_body text,p_media_path text default null,p_gif_url text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare clean_body text:=btrim(coalesce(p_body,'')); item public.wall_post_replies%rowtype;
begin
  perform public.assert_player_not_banned();
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  perform pg_advisory_xact_lock(hashtextextended('wall-interactions:'||auth.uid()::text,0));
  perform public.wall_interaction_owner(p_post_id);
  if p_id is null or char_length(clean_body)>1000 or (clean_body='' and p_media_path is null and p_gif_url is null)
    or (p_media_path is not null and p_gif_url is not null) then raise exception 'WALL_REPLY_INVALID'; end if;
  if p_gif_url is not null and (char_length(p_gif_url)>1000 or p_gif_url !~ '^https://(media[0-9]*|i)\.giphy\.com/')
    then raise exception 'WALL_GIF_INVALID'; end if;
  select * into item from public.wall_post_replies where id=p_id;
  if found then
    if item.post_id<>p_post_id or item.user_id<>auth.uid() or item.body<>clean_body
      or item.parent_reply_id is distinct from p_parent_id
      or item.media_path is distinct from p_media_path or item.gif_url is distinct from p_gif_url then raise exception 'WALL_REPLY_INVALID'; end if;
    return public.get_wall_post_activity(p_post_id);
  end if;
  if (select count(*) from public.wall_post_replies where user_id=auth.uid() and created_at>now()-interval '1 hour')>=30
    or exists(select 1 from public.wall_post_replies where user_id=auth.uid() and created_at>clock_timestamp()-interval '5 seconds')
    then raise exception 'WALL_REPLY_RATE_LIMITED'; end if;
  perform 1 from public.profile_wall_posts where id=p_post_id for update;
  if p_parent_id is null or not exists(select 1 from public.wall_post_replies r where r.id=p_parent_id and r.post_id=p_post_id and public.wall_reply_author_visible(r.user_id)) then raise exception 'WALL_REPLY_UNAVAILABLE'; end if;
  perform 1 from public.wall_post_replies where id=p_parent_id and post_id=p_post_id and public.wall_reply_author_visible(user_id) for share;
  if not found then raise exception 'WALL_REPLY_UNAVAILABLE'; end if;
  if (select count(*) from public.wall_post_replies where post_id=p_post_id)>=500 then raise exception 'WALL_REPLIES_FULL'; end if;
  if p_media_path is not null and (split_part(p_media_path,'/',1)<>auth.uid()::text
      or p_media_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$'
      or not exists(select 1 from storage.objects o where bucket_id='profile-wall-media' and name=p_media_path
        and case when (to_jsonb(o)->'metadata'->>'size') ~ '^[0-9]{1,12}$'
          then (to_jsonb(o)->'metadata'->>'size')::bigint between 1 and 6291456 else false end
        and to_jsonb(o)->'metadata'->>'mimetype' in('image/jpeg','image/png','image/webp','image/gif')))
    then raise exception 'WALL_MEDIA_INVALID'; end if;
  insert into public.wall_post_replies(id,post_id,user_id,body,media_path,gif_url,parent_reply_id)
    values(p_id,p_post_id,auth.uid(),clean_body,p_media_path,p_gif_url,p_parent_id);
  return public.get_wall_post_activity(p_post_id);
end; $$;

revoke all on function public.publish_wall_post_reply_to(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_wall_post_reply_to(uuid,uuid,uuid,text,text,text) to authenticated;

create or replace function public.get_wall_post_activity_without_reactions(p_post_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; owner_id uuid;
begin
  owner_id:=public.wall_interaction_owner(p_post_id);
  if (p_before is null)<>(p_before_id is null) then raise exception 'WALL_CURSOR_INVALID'; end if;
  with page as materialized (
    select r.*,p.pseudo,p.avatar_url,row_number() over(order by r.created_at desc,r.id desc) n
    from public.wall_post_replies r join public.user_profiles p on p.user_id=r.user_id
    where r.post_id=p_post_id and public.wall_reply_author_visible(r.user_id)
      and (p_before is null or (r.created_at,r.id)<(p_before,p_before_id))
    order by r.created_at desc,r.id desc limit 11
  ) select jsonb_build_object(
    'publicReplyNotice',exists(select 1 from public.user_profiles where user_id=owner_id and is_public)
      and owner_id<>auth.uid() and public.friendship_state(auth.uid(),owner_id) is distinct from 'accepted',
    'likes',(select count(*) from public.wall_post_likes l where l.post_id=p_post_id and public.wall_actor_visible(l.user_id)),
    'likedByMe',exists(select 1 from public.wall_post_likes where post_id=p_post_id and user_id=auth.uid()),
    'replyCount',(select count(*) from public.wall_post_replies r where r.post_id=p_post_id and public.wall_reply_author_visible(r.user_id)),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',body,'parentId',parent_reply_id,'createdAt',created_at,'isMe',user_id=auth.uid(),
      'canDelete',user_id=auth.uid() or owner_id=auth.uid(),'hasMedia',media_path is not null,'mediaPath',case when user_id=auth.uid() then media_path else null end,'gifUrl',gif_url,
      'author',jsonb_build_object('id',user_id,'name',pseudo,'avatarUrl',avatar_url)) order by created_at desc,id desc)
      from page where n<=10),'[]'::jsonb),
    'next',case when exists(select 1 from page where n=11) then
      (select jsonb_build_object('at',created_at,'id',id) from page where n=10) else null end
  ) into result;
  -- The cursor still pages ten contributions. Include only their visible ancestors
  -- so a recent reply remains under its parent even across pagination boundaries.
  with recursive chain as (
    select r.* from public.wall_post_replies r where r.post_id=p_post_id
      and r.id in(select (value->>'id')::uuid from jsonb_array_elements(result->'items'))
    union
    select p.* from public.wall_post_replies p join chain c on c.parent_reply_id=p.id
      where p.post_id=p_post_id and public.wall_reply_author_visible(p.user_id)
  ) select result || jsonb_build_object('threadContext',coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'text',r.body,'parentId',r.parent_reply_id,'createdAt',r.created_at,'isMe',r.user_id=auth.uid(),
    'canDelete',r.user_id=auth.uid() or owner_id=auth.uid(),'hasMedia',r.media_path is not null,
    'mediaPath',case when r.user_id=auth.uid() then r.media_path else null end,'gifUrl',r.gif_url,
    'author',jsonb_build_object('id',r.user_id,'name',p.pseudo,'avatarUrl',p.avatar_url)) order by r.created_at,r.id)
    from chain r join public.user_profiles p on p.user_id=r.user_id
    where not exists(select 1 from jsonb_array_elements(result->'items') item where item->>'id'=r.id::text)), '[]'::jsonb)) into result;
  return result;
end; $$;

create or replace function public.notify_wall_post_reply() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  if new.parent_reply_id is not null then
    select user_id into owner_id from public.wall_post_replies where id=new.parent_reply_id and post_id=new.post_id;
    if owner_id is not null and owner_id<>new.user_id and public.wall_reply_author_visible(owner_id)
      and public.wall_reply_author_visible(new.user_id)
      and public.wall_post_interaction_allowed(owner_id,new.post_id)
      and public.wall_post_interaction_allowed(new.user_id,new.post_id) then
      insert into public.notifications(user_id,type,reference_id,actor_user_id,created_at)
        values(owner_id,'wall_reply_received',new.id,new.user_id,clock_timestamp());
    end if;
    return new;
  end if;
  select user_id into owner_id from public.profile_wall_posts where id=new.post_id;
  if owner_id is null or owner_id=new.user_id
    or not public.wall_actor_visible(owner_id) or not public.wall_reply_author_visible(new.user_id)
    or not public.wall_post_interaction_allowed(new.user_id,new.post_id)
    then return new; end if;
  -- One item per post, not per reply. Store neither the post body nor reply text.
  -- The publication RPC inserts only once for an idempotent retry.
  insert into public.notifications(user_id,type,reference_id,actor_user_id,created_at)
    values(owner_id,'wall_post_reply',new.post_id,new.user_id,clock_timestamp())
    on conflict(user_id,type,reference_id) do update
      set actor_user_id=excluded.actor_user_id,read_at=null,created_at=clock_timestamp();
  return new;
end; $$;

create or replace function public.interaction_notification_actor(n public.notifications)
returns uuid language sql stable security definer set search_path='' as $$
  select case
    when n.type in ('auction_chat_mention','private_message_received','wall_post_reply','wall_reply_received') then n.actor_user_id
    when n.type='friend_request' then (select user_id from public.friendships where id=n.reference_id)
    when n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_cancelled') then (select from_user from public.trade_offers where id=n.reference_id)
    when n.type in ('trade_offer_accepted','trade_offer_declined') then (select to_user from public.trade_offers where id=n.reference_id)
  end
$$;
create or replace function public.cleanup_wall_reply_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.notifications n where n.type='wall_reply_received' and (n.reference_id=old.id
    or n.reference_id in(select id from public.wall_post_replies where parent_reply_id=old.id));
  -- Also runs when the parent post/account deletion cascades to its replies.
  delete from public.notifications n where n.type='wall_post_reply' and n.reference_id=old.post_id
    and not exists(select 1 from public.wall_post_replies r where r.post_id=old.post_id and r.user_id=n.actor_user_id);
  return old;
end; $$;

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg((jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',coalesce(n.reference_id::text,n.achievement_id),'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'achievementName',achievement.titre,
      'actorPseudo',coalesce(mention_actor.pseudo,friend_sender.pseudo,trade_actor.pseudo,case when n.type in ('auction_chat_mention','friend_request','trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled') then 'Deleted player' end)
    ) || case when n.type='wall_reply_received' then (select jsonb_build_object('postOwnerId',w.user_id,'postId',w.id,'replyId',r.id) from public.wall_post_replies r join public.profile_wall_posts w on w.id=r.post_id where r.id=n.reference_id) else '{}'::jsonb end || case when n.type='auction_sold' then jsonb_build_object('karaAmount',a.current_price) else '{}'::jsonb end)
      order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id
      and (type<>'private_message_received' or public.private_messaging_allowed(player_id,actor_user_id))
      and (type<>'wall_reply_received' or exists(
        select 1 from public.wall_post_replies child join public.wall_post_replies parent on parent.id=child.parent_reply_id
        where child.id=reference_id and parent.user_id=player_id and child.user_id=actor_user_id
          and public.wall_reply_author_visible(child.user_id) and public.wall_reply_author_visible(parent.user_id)
          and public.wall_post_interaction_allowed(player_id,child.post_id)
          and public.wall_post_interaction_allowed(child.user_id,child.post_id)))
      and (type<>'wall_post_reply' or (
        public.wall_actor_visible(player_id) and public.wall_reply_author_visible(actor_user_id)
        and exists(select 1 from public.profile_wall_posts w where w.id=reference_id and w.user_id=player_id)
        and exists(select 1 from public.wall_post_replies r where r.post_id=reference_id and r.user_id=actor_user_id)
        and public.wall_post_interaction_allowed(actor_user_id,reference_id)
      ))
      and not public.users_blocked(player_id,public.interaction_notification_actor(notifications))
      order by created_at desc limit safe_limit) n
    left join public.auctions a on n.type in ('wishlist_card_on_auction','outbid','auction_won','auction_sold','auction_chat_mention') and a.id=n.reference_id
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.user_profiles mention_actor on mention_actor.user_id=n.actor_user_id
    left join public.friendships f on n.type='friend_request' and f.id=n.reference_id
    left join public.user_profiles friend_sender on friend_sender.user_id=f.user_id
    left join public.trade_offers trade on n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled') and trade.id=n.reference_id
    left join public.user_profiles trade_actor on trade_actor.user_id=case
      when n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_cancelled') then trade.from_user
      when n.type in ('trade_offer_accepted','trade_offer_declined') then trade.to_user
    end
    left join public.achievements achievement on achievement.id=n.achievement_id);
end; $$;

create or replace function public.get_push_notification(p_id uuid,p_created_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare player_id uuid; result jsonb; previous_sub text:=current_setting('request.jwt.claim.sub',true);
begin
  select user_id into player_id from public.notifications where id=p_id and created_at=p_created_at;
  if player_id is null then return null; end if;
  -- Existing ACL helpers use auth.uid(); identity comes only from the stored row.
  perform set_config('request.jwt.claim.sub',player_id::text,true);
  if not public.wall_actor_visible(player_id) then
    perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    return null;
  end if;
  result:=(select coalesce(jsonb_agg((jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',coalesce(n.reference_id::text,n.achievement_id),'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'achievementName',achievement.titre,
      'actorPseudo',coalesce(mention_actor.pseudo,friend_sender.pseudo,trade_actor.pseudo)
    ) || case when n.type='wall_reply_received' then (select jsonb_build_object('postOwnerId',w.user_id,'postId',w.id,'replyId',r.id) from public.wall_post_replies r join public.profile_wall_posts w on w.id=r.post_id where r.id=n.reference_id) else '{}'::jsonb end || case when n.type='auction_sold' then jsonb_build_object('karaAmount',a.current_price) else '{}'::jsonb end)
      order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id and id=p_id and created_at=p_created_at
      and (type<>'private_message_received' or public.private_messaging_allowed(player_id,actor_user_id))
      and (type<>'wall_reply_received' or exists(
        select 1 from public.wall_post_replies child join public.wall_post_replies parent on parent.id=child.parent_reply_id
        where child.id=reference_id and parent.user_id=player_id and child.user_id=actor_user_id
          and public.wall_reply_author_visible(child.user_id) and public.wall_reply_author_visible(parent.user_id)
          and public.wall_post_interaction_allowed(player_id,child.post_id)
          and public.wall_post_interaction_allowed(child.user_id,child.post_id)))
      and (type<>'wall_post_reply' or (
        public.wall_actor_visible(player_id) and public.wall_reply_author_visible(actor_user_id)
        and exists(select 1 from public.profile_wall_posts w where w.id=reference_id and w.user_id=player_id)
        and exists(select 1 from public.wall_post_replies r where r.post_id=reference_id and r.user_id=actor_user_id)
        and public.wall_post_interaction_allowed(actor_user_id,reference_id)
      ))
      and not public.users_blocked(player_id,public.interaction_notification_actor(notifications))
      order by created_at desc) n
    left join public.auctions a on n.type in ('wishlist_card_on_auction','outbid','auction_won','auction_sold','auction_chat_mention') and a.id=n.reference_id
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.user_profiles mention_actor on mention_actor.user_id=n.actor_user_id
    left join public.friendships f on n.type='friend_request' and f.id=n.reference_id
    left join public.user_profiles friend_sender on friend_sender.user_id=f.user_id
    left join public.trade_offers trade on n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled') and trade.id=n.reference_id
    left join public.user_profiles trade_actor on trade_actor.user_id=case
      when n.type in ('trade_offer_received','trade_counter_offer_received','trade_offer_cancelled') then trade.from_user
      when n.type in ('trade_offer_accepted','trade_offer_declined') then trade.to_user
    end
    left join public.achievements achievement on achievement.id=n.achievement_id);
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  return jsonb_build_object('userId',player_id,'locale',(select locale from public.user_profiles where user_id=player_id),'notification',result->0);
end; $$;

-- Preserve the existing export reservation and size fences; include only the
-- parent's identifier on the requesting player's own contribution.
create or replace function public.build_data_export_without_referrals(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  select public.build_data_export_without_reply_media(p_user_id,p_request_id) || jsonb_build_object(
    'wall_post_replies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'post_id',post_id,'text',body,'parent_reply_id',parent_reply_id,
      'gif_url',gif_url,'has_image',media_path is not null,'created_at',created_at))
      from (select * from public.wall_post_replies where user_id=p_user_id limit 100001) r),'[]'::jsonb)
  ) into result;
  if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
      when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result))>100000
    or octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
  return result;
end; $$;

create or replace function public.mark_private_messages_read(p_friend_id uuid,p_last_message_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); delivery bigint;
begin
  perform public.assert_player_not_banned();
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_friend_id is null or p_friend_id=viewer then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||least(viewer,p_friend_id)::text,0));
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('account-deletion:'||greatest(viewer,p_friend_id)::text,0));
  perform public.lock_social_pair(viewer,p_friend_id);
  if not public.private_messaging_allowed(viewer,p_friend_id) then raise exception 'MESSAGES_UNAVAILABLE'; end if;
  select read_order into delivery from public.private_messages
    where id=p_last_message_id and sender_id=p_friend_id and recipient_id=viewer;
  if delivery is null then raise exception 'MESSAGE_READ_INVALID'; end if;
  insert into public.private_message_reads(viewer_id,friend_id,last_read_order) values(viewer,p_friend_id,delivery)
    on conflict(viewer_id,friend_id) do update
    set last_read_order=greatest(private_message_reads.last_read_order,excluded.last_read_order);
  -- Only acknowledge this conversation once every delivered incoming message
  -- is covered. A newer delivery must keep its bell notification unread.
  update public.notifications n set read_at=clock_timestamp()
    where n.user_id=viewer and n.type='private_message_received' and n.reference_id=p_friend_id and n.read_at is null
      and not exists(select 1 from public.private_messages m
        join public.private_message_reads r on r.viewer_id=viewer and r.friend_id=p_friend_id
        where m.recipient_id=viewer and m.sender_id=p_friend_id and m.read_order>r.last_read_order);
  return true;
end; $$;


-- Repair past discrepancies, without marking any unseen delivery or unrelated
-- notification as read. The stored monotonic watermark is the only evidence.
update public.notifications n set read_at=clock_timestamp()
 from public.private_message_reads r
 where n.type='private_message_received' and n.read_at is null
   and r.viewer_id=n.user_id and r.friend_id=n.reference_id
   and not exists(select 1 from public.private_messages m where m.recipient_id=n.user_id
     and m.sender_id=n.reference_id and m.read_order>r.last_read_order);

notify pgrst,'reload schema';
commit;
