begin;
set local lock_timeout='3s';

-- Internal authority for post interactions, including callers used by notification
-- readers. Viewer ids come only from owning wrappers, never an API argument.
create function public.wall_post_interaction_allowed(p_viewer uuid,p_post_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profile_wall_posts w
    join public.user_profiles p on p.user_id=w.user_id
    join auth.users author on author.id=w.user_id
    join auth.users viewer on viewer.id=p_viewer
    join public.user_profiles vp on vp.user_id=viewer.id
    where w.id=p_post_id
      and coalesce((to_jsonb(author)->>'banned_until')::timestamptz,'-infinity')<=now()
      and coalesce((to_jsonb(viewer)->>'banned_until')::timestamptz,'-infinity')<=now()
      and not exists(select 1 from public.account_deletion_log where user_id in(p_viewer,w.user_id))
      and not public.users_blocked(p_viewer,w.user_id)
      and public.can_view_collection(p_viewer,w.user_id)
  )
$$;
revoke all on function public.wall_post_interaction_allowed(uuid,uuid) from public,anon,authenticated,service_role;

-- Wall post reads and storage policies also reject inactive readers/authors.
create or replace function public.can_read_profile_wall(p_owner_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and exists(select 1 from auth.users u where u.id=auth.uid()
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now())
    and exists(select 1 from auth.users u where u.id=p_owner_id
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now())
    and exists(select 1 from public.user_profiles where user_id=p_owner_id)
    and not exists(select 1 from public.account_deletion_log where user_id in(auth.uid(),p_owner_id))
    and not exists(select 1 from public.user_blocks where
      (blocker_id=auth.uid() and blocked_id=p_owner_id) or (blocker_id=p_owner_id and blocked_id=auth.uid()))
    and public.can_view_collection(auth.uid(),p_owner_id)
$$;

-- A contribution inherits its parent audience, not its author's private wall.
-- Keep profile visibility in wall_actor_visible for every non-reply surface.
create function public.wall_reply_author_visible(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from auth.users u join public.user_profiles p on p.user_id=u.id
    where u.id=p_user and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now())
    and not exists(select 1 from public.account_deletion_log where user_id=p_user)
    and not public.users_blocked(auth.uid(),p_user)
$$;
revoke all on function public.wall_reply_author_visible(uuid) from public,anon,authenticated,service_role;

-- Every existing activity/like/reaction/reply RPC already goes through this gate.
create or replace function public.wall_interaction_owner(p_post uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid;
begin
  if auth.uid() is null or not public.wall_actor_visible(auth.uid()) then raise exception 'AUTH_REQUIRED'; end if;
  if not public.wall_post_interaction_allowed(auth.uid(),p_post) then raise exception 'WALL_POST_UNAVAILABLE'; end if;
  select user_id into owner_id from public.profile_wall_posts where id=p_post;
  return owner_id;
end; $$;
revoke all on function public.wall_interaction_owner(uuid) from public,anon,authenticated,service_role;


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
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',body,'createdAt',created_at,'isMe',user_id=auth.uid(),
      'canDelete',user_id=auth.uid() or owner_id=auth.uid(),'hasMedia',media_path is not null,'mediaPath',case when user_id=auth.uid() then media_path else null end,'gifUrl',gif_url,
      'author',jsonb_build_object('id',user_id,'name',pseudo,'avatarUrl',avatar_url)) order by created_at desc,id desc)
      from page where n<=10),'[]'::jsonb),
    'next',case when exists(select 1 from page where n=11) then
      (select jsonb_build_object('at',created_at,'id',id) from page where n=10) else null end
  ) into result;
  return result;
end; $$;

create or replace function public.report_user(p_user_id uuid,p_reason text,p_context_type text default 'profile',p_context_id uuid default null,p_details text default '',p_block_also boolean default false)
returns uuid language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare player_id uuid:=auth.uid(); content jsonb:='{}'; report_id uuid; day_start timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_user_id is null or p_user_id=player_id or not exists(select 1 from public.user_profiles where user_id=p_user_id)
    or p_reason is null or p_reason not in ('harassment','inappropriate','spam','cheating','other')
    or p_context_type is null or p_context_type not in ('profile','auction_chat','wall_post','wall_reply')
    or char_length(coalesce(p_details,''))>500 or (p_context_type='profile' and p_context_id is not null)
    then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  if p_context_type='auction_chat' then
    select jsonb_build_object('message',left(m.message,500),'gifUrl',left(m.gif_url,1000))
      into content from public.auction_chat_messages m where m.id=p_context_id and m.user_id=p_user_id;
    if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  elsif p_context_type='wall_post' then
    select jsonb_build_object('message',w.body,'gifUrl',w.gif_url,'hasMedia',w.media_path is not null,
      'author',jsonb_build_object('id',p.user_id,'pseudo',p.pseudo),'createdAt',w.created_at)
    into content from public.profile_wall_posts w join public.user_profiles p on p.user_id=w.user_id
    where w.id=p_context_id and w.user_id=p_user_id and public.wall_post_interaction_allowed(player_id,w.id) for share of w;
    if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  elsif p_context_type='wall_reply' then
    select jsonb_build_object('message',r.body,'gifUrl',r.gif_url,'hasMedia',r.media_path is not null,
      'author',jsonb_build_object('id',p.user_id,'pseudo',p.pseudo),'createdAt',r.created_at,'postId',r.post_id)
    into content from public.wall_post_replies r join public.profile_wall_posts w on w.id=r.post_id
      join public.user_profiles p on p.user_id=r.user_id
    where r.id=p_context_id and r.user_id=p_user_id and public.wall_actor_visible(player_id)
      and public.wall_reply_author_visible(r.user_id) and public.wall_post_interaction_allowed(player_id,w.id)
    for share of r,w;
    if not found then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('report:'||player_id::text,0));
  if exists(select 1 from public.user_reports where reporter_id=player_id and reported_id=p_user_id and context_type=p_context_type
    and context_id is not distinct from p_context_id) then raise exception 'REPORT_DUPLICATE' using errcode='P0001'; end if;
  if (select count(*) from public.user_reports where reporter_id=player_id and created_at>=day_start)>=10
    then raise exception 'REPORT_LIMIT' using errcode='P0001'; end if;
  insert into public.user_reports(reporter_id,reported_id,reason,context_type,context_id,snapshot,details)
    values(player_id,p_user_id,p_reason,p_context_type,p_context_id,content,coalesce(p_details,'')) returning id into report_id;
  if p_block_also then perform public.block_user(p_user_id); end if;
  return report_id;
end; $$;

-- Reply visibility follows the parent, with active-author and bilateral-block checks.
-- Storage reads must use the same parent-post gate as the reply activity.
create table public.wall_reply_media_cleanup (
  media_path text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  object_id text not null
);
alter table public.wall_reply_media_cleanup enable row level security;
revoke all on public.wall_reply_media_cleanup from public,anon,authenticated,service_role;

create or replace function public.wall_reply_media_access(p_path text,p_delete boolean) returns boolean
language sql stable security definer set search_path='' as $$
  select public.wall_actor_visible(auth.uid()) and case when p_delete then
    not exists(select 1 from public.wall_post_replies where media_path=p_path)
    and not exists(select 1 from public.profile_wall_posts where media_path=p_path)
    and split_part(p_path,'/',1)=auth.uid()::text
  else exists(select 1 from public.wall_post_replies r where r.media_path=p_path
    and public.wall_reply_author_visible(r.user_id)
    and public.wall_post_interaction_allowed(auth.uid(),r.post_id)) end
$$;

create or replace function public.get_wall_reply_media(p_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare item public.wall_post_replies%rowtype;
begin
  select * into item from public.wall_post_replies where id=p_id;
  if not found then raise exception 'WALL_POST_UNAVAILABLE'; end if;
  perform public.wall_interaction_owner(item.post_id);
  if not public.wall_reply_author_visible(item.user_id) then raise exception 'WALL_POST_UNAVAILABLE'; end if;
  return item.media_path;
end; $$;

-- No SELECT/DELETE storage grant is widened for moderators. A server action
-- checks this exact-object receipt before using the existing service cleanup.
create function public.authorize_wall_reply_media_cleanup(p_path text) returns text
language plpgsql stable security definer set search_path='' as $$
declare receipt public.wall_reply_media_cleanup%rowtype; current_id text;
begin
  if auth.uid() is null or not public.wall_actor_visible(auth.uid()) then raise exception 'AUTH_REQUIRED'; end if;
  select * into receipt from public.wall_reply_media_cleanup where media_path=p_path and user_id=auth.uid();
  if not found then raise exception 'WALL_MEDIA_INVALID'; end if;
  select to_jsonb(o)->>'id' into current_id from storage.objects o where o.bucket_id='profile-wall-media' and o.name=p_path;
  if not found then return null; end if;
  if current_id is distinct from receipt.object_id
    or exists(select 1 from public.profile_wall_posts where media_path=p_path)
    or exists(select 1 from public.wall_post_replies where media_path=p_path) then raise exception 'WALL_MEDIA_INVALID'; end if;
  return p_path;
end; $$;
revoke all on function public.authorize_wall_reply_media_cleanup(text) from public,anon,authenticated,service_role;
grant execute on function public.authorize_wall_reply_media_cleanup(text) to authenticated;

create or replace function public.delete_wall_post_reply(p_post_id uuid,p_reply_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; item public.wall_post_replies%rowtype; owner_id uuid;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  owner_id:=public.wall_interaction_owner(p_post_id);
  select * into item from public.wall_post_replies where id=p_reply_id and post_id=p_post_id for update;
  if found and (item.user_id=auth.uid() or owner_id=auth.uid()) then
    if item.media_path is not null and item.user_id<>auth.uid() then
      insert into public.wall_reply_media_cleanup(media_path,user_id,object_id)
        select o.name,auth.uid(),to_jsonb(o)->>'id' from storage.objects o
        where o.bucket_id='profile-wall-media' and o.name=item.media_path and to_jsonb(o)->>'id' is not null
        on conflict(media_path) do update set user_id=excluded.user_id,object_id=excluded.object_id;
    end if;
    result:=public.delete_wall_content_core('wall_reply',p_reply_id);
  end if;
  return public.get_wall_post_activity(p_post_id)||jsonb_build_object('deletedMediaPath',result->>'mediaPath');
end; $$;


create or replace function public.notify_wall_post_reply() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
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

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg((jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',coalesce(n.reference_id::text,n.achievement_id),'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'achievementName',achievement.titre,
      'actorPseudo',coalesce(mention_actor.pseudo,friend_sender.pseudo,trade_actor.pseudo,case when n.type in ('auction_chat_mention','friend_request','trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled') then 'Deleted player' end)
    ) || case when n.type='auction_sold' then jsonb_build_object('karaAmount',a.current_price) else '{}'::jsonb end)
      order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id
      and (type<>'private_message_received' or public.private_messaging_allowed(player_id,actor_user_id))
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

revoke all on function public.get_wall_post_activity_without_reactions(uuid,timestamptz,uuid),
  public.notify_wall_post_reply() from public,anon,authenticated,service_role;
revoke all on function public.report_user(uuid,text,text,uuid,text,boolean),public.wall_reply_media_access(text,boolean),
  public.delete_wall_post_reply(uuid,uuid),public.get_wall_reply_media(uuid),public.list_notifications(integer) from public,anon,authenticated,service_role;
grant execute on function public.report_user(uuid,text,text,uuid,text,boolean),public.wall_reply_media_access(text,boolean),
  public.delete_wall_post_reply(uuid,uuid),public.get_wall_reply_media(uuid),public.list_notifications(integer) to authenticated;
notify pgrst,'reload schema';
commit;
