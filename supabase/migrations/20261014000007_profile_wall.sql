begin;

create table public.profile_wall_posts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 3000),
  media_path text unique,
  gif_url text check (gif_url is null or (char_length(gif_url)<=1000 and gif_url ~ '^https://(media[0-9]*|i)\.giphy\.com/')),
  created_at timestamptz not null default clock_timestamp(),
  check (btrim(body) <> '' or media_path is not null or gif_url is not null),
  check (media_path is null or (split_part(media_path,'/',1)=user_id::text and media_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$')),
  check (media_path is null or gif_url is null)
);
create index profile_wall_posts_page on public.profile_wall_posts(user_id,created_at desc,id desc);
alter table public.profile_wall_posts enable row level security;
revoke all on public.profile_wall_posts from public,anon,authenticated;
grant select on public.profile_wall_posts to authenticated;
grant all on public.profile_wall_posts to service_role;
create trigger account_deletion_write_guard before insert or update or delete on public.profile_wall_posts
  for each statement execute function public.guard_deleted_account();
create trigger account_deletion_reference_guard before insert or update on public.profile_wall_posts
  for each row execute function public.guard_deleted_account();

-- Viewer identity always comes from auth.uid(), never from a supplied viewer ID.
create function public.can_read_profile_wall(p_owner_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and exists(select 1 from public.user_profiles where user_id=p_owner_id)
    and not exists(select 1 from public.account_deletion_log where user_id in(auth.uid(),p_owner_id))
    and not exists(select 1 from public.user_blocks where
      (blocker_id=auth.uid() and blocked_id=p_owner_id) or (blocker_id=p_owner_id and blocked_id=auth.uid()))
    and public.can_view_collection(auth.uid(),p_owner_id)
$$;
revoke all on function public.can_read_profile_wall(uuid) from public,anon,authenticated;
grant execute on function public.can_read_profile_wall(uuid) to authenticated;
create policy profile_wall_read on public.profile_wall_posts for select to authenticated
  using (public.can_read_profile_wall(user_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('profile-wall-media','profile-wall-media',false,6291456,array['image/jpeg','image/png','image/webp','image/gif']);
alter table storage.objects enable row level security;
-- Serialize uploads per author; count drafts too, so failed publication cannot bypass the quota.
create function public.guard_profile_wall_upload()
returns trigger language plpgsql security definer set search_path='' as $$
declare player uuid:=auth.uid(); bytes bigint;
begin
  if new.bucket_id<>'profile-wall-media' or player is null then return new; end if;
  if split_part(new.name,'/',1)<>player::text then raise exception 'WALL_MEDIA_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profile-wall-upload:'||player::text,0));
  select coalesce(sum(case when (to_jsonb(o)->'metadata'->>'size') ~ '^[0-9]{1,12}$' then (to_jsonb(o)->'metadata'->>'size')::bigint else 6291456 end),0) into bytes
    from storage.objects o where bucket_id='profile-wall-media' and split_part(name,'/',1)=player::text;
  if bytes+6291456>104857600 then raise exception 'WALL_STORAGE_FULL'; end if;
  return new;
end; $$;
revoke all on function public.guard_profile_wall_upload() from public,anon,authenticated;
create trigger profile_wall_upload_quota before insert on storage.objects
  for each row execute function public.guard_profile_wall_upload();
create policy profile_wall_media_read on storage.objects for select to authenticated using (
  bucket_id='profile-wall-media' and (
    (split_part(name,'/',1)=auth.uid()::text and public.can_read_profile_wall(auth.uid()))
    or exists(select 1 from public.profile_wall_posts p where p.media_path=name and public.can_read_profile_wall(p.user_id))
  )
);
create policy profile_wall_media_insert on storage.objects for insert to authenticated with check (
  bucket_id='profile-wall-media' and split_part(name,'/',1)=auth.uid()::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$'
  and public.can_read_profile_wall(auth.uid())
);
-- No UPDATE policy: published files are immutable. Referenced attachments cannot be removed.
create policy profile_wall_media_delete on storage.objects for delete to authenticated using (
  bucket_id='profile-wall-media' and split_part(name,'/',1)=auth.uid()::text
  and public.can_read_profile_wall(auth.uid())
  and not exists(select 1 from public.profile_wall_posts p where p.media_path=name)
);

create function public.get_profile_wall(p_owner_id uuid,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; safe_limit integer:=least(greatest(coalesce(p_limit,20),1),20);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_read_profile_wall(p_owner_id) then raise exception 'WALL_PRIVATE'; end if;
  if (p_before is null) <> (p_before_id is null) then raise exception 'WALL_CURSOR_INVALID'; end if;
  with page as materialized (
    select p.*,row_number() over(order by created_at desc,id desc) n from public.profile_wall_posts p
    where user_id=p_owner_id and (p_before is null or (created_at,id)<(p_before,p_before_id))
    order by created_at desc,id desc limit safe_limit+1
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',body,'mediaPath',media_path,'gifUrl',gif_url,'createdAt',created_at) order by created_at desc,id desc) from page where n<=safe_limit),'[]'::jsonb),
    'next',case when exists(select 1 from page where n>safe_limit) then
      (select jsonb_build_object('at',created_at,'id',id) from page where n=safe_limit) else null end
  ) into result;
  return result;
end; $$;

create function public.publish_profile_wall_post(p_id uuid,p_body text,p_media_path text default null,p_gif_url text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare player uuid:=auth.uid(); clean_body text:=btrim(coalesce(p_body,'')); post public.profile_wall_posts%rowtype;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_read_profile_wall(player) then raise exception 'WALL_UNAVAILABLE'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||player::text,0));
  perform pg_advisory_xact_lock(hashtextextended('profile-wall:'||player::text,0));
  if p_id is null or char_length(clean_body)>3000 or (clean_body='' and p_media_path is null and p_gif_url is null)
    or (p_media_path is not null and p_gif_url is not null) then raise exception 'WALL_POST_INVALID'; end if;
  if p_gif_url is not null and (char_length(p_gif_url)>1000 or p_gif_url !~ '^https://(media[0-9]*|i)\.giphy\.com/') then raise exception 'WALL_GIF_INVALID'; end if;
  select * into post from public.profile_wall_posts where id=p_id;
  if found then
    if post.user_id<>player or post.body<>clean_body or post.media_path is distinct from p_media_path or post.gif_url is distinct from p_gif_url then raise exception 'WALL_POST_INVALID'; end if;
  else
    if (select count(*) from public.profile_wall_posts where user_id=player)>=500 then raise exception 'WALL_FULL'; end if;
    if (select count(*) from public.profile_wall_posts where user_id=player and created_at>clock_timestamp()-interval '1 hour')>=30
      or exists(select 1 from public.profile_wall_posts where user_id=player and created_at>clock_timestamp()-interval '5 seconds') then raise exception 'WALL_RATE_LIMITED'; end if;
    if p_media_path is not null and (
      split_part(p_media_path,'/',1)<>player::text or p_media_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$'
      or not exists(select 1 from storage.objects where bucket_id='profile-wall-media' and name=p_media_path)
    ) then raise exception 'WALL_MEDIA_INVALID'; end if;
    insert into public.profile_wall_posts(id,user_id,body,media_path,gif_url)
    values(p_id,player,clean_body,p_media_path,p_gif_url) returning * into post;
  end if;
  return jsonb_build_object('id',post.id,'text',post.body,'mediaPath',post.media_path,'gifUrl',post.gif_url,'createdAt',post.created_at);
end; $$;

create function public.delete_profile_wall_post(p_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare path text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_read_profile_wall(auth.uid()) then raise exception 'WALL_UNAVAILABLE'; end if;
  delete from public.profile_wall_posts where id=p_id and user_id=auth.uid() returning media_path into path;
  if not found then raise exception 'WALL_POST_NOT_FOUND'; end if;
  return path;
end; $$;
revoke all on function public.get_profile_wall(uuid,timestamptz,uuid,integer),public.publish_profile_wall_post(uuid,text,text,text),public.delete_profile_wall_post(uuid) from public,anon,authenticated;
grant execute on function public.get_profile_wall(uuid,timestamptz,uuid,integer),public.publish_profile_wall_post(uuid,text,text,text),public.delete_profile_wall_post(uuid) to authenticated;

-- Export/account-removal extensions follow below. No personal-media URL is made public.
create or replace function public.begin_account_deletion(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_user_id is null then raise exception 'INVALID_ACCOUNT' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user_id::text,0));
  -- Never erase catalogue/global assets as part of personal account removal.
  if exists(select 1 from storage.objects o where o.bucket_id not in ('avatars','profile-wall-media')
    and (o.owner_id=p_user_id::text or to_jsonb(o)->>'owner'=p_user_id::text)) then
    raise exception 'STORAGE_OWNERSHIP_REQUIRES_REVIEW' using errcode='P0001';
  end if;
  insert into public.account_deletion_log(user_id) values(p_user_id) on conflict do nothing;
end; $$;

create or replace function public.prepare_account_deletion(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sale record; owned_ids uuid[]; objects jsonb;
begin
  if p_user_id is null or not exists(select 1 from public.account_deletion_log where user_id=p_user_id) then
    raise exception 'ACCOUNT_DELETION_NOT_STARTED' using errcode='P0001';
  end if;
  -- Serialize retries of the same deletion, after the committed fence.
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user_id::text,0));
  if exists(select 1 from storage.objects o where o.bucket_id not in ('avatars','profile-wall-media')
    and (o.owner_id=p_user_id::text or to_jsonb(o)->>'owner'=p_user_id::text)) then
    raise exception 'STORAGE_OWNERSHIP_REQUIRES_REVIEW' using errcode='P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'name',o.name) order by o.name),'[]') into objects
    from storage.objects o where o.bucket_id in ('avatars','profile-wall-media') and
      (o.owner_id=p_user_id::text or to_jsonb(o)->>'owner'=p_user_id::text or split_part(o.name,'/',1)=p_user_id::text);
  -- Auctions first, then all affected balances in UUID order, as in place_bid.
  perform 1 from public.auctions where status='active' and (seller_id=p_user_id or buyer_id=p_user_id) order by id for update;
  -- Social mutators lock friendships, then offers; trade acceptance locks offers
  -- before balances. Preserve those orders while cancelling pending interactions.
  perform 1 from public.friendships where user_id=p_user_id or friend_id=p_user_id order by id for update;
  perform 1 from public.trade_offers where from_user=p_user_id or to_user=p_user_id order by id for update;
  perform 1 from public.user_profiles where user_id=p_user_id or user_id in
    (select buyer_id from public.auctions where status='active' and seller_id=p_user_id)
    order by user_id for no key update;
  for sale in select * from public.auctions where status='active' and (seller_id=p_user_id or buyer_id=p_user_id) order by id loop
    if sale.buyer_id is not null then perform public.credit_karas(sale.buyer_id,sale.current_price); end if;
    if sale.seller_id=p_user_id then
      update public.auctions set status='expired',buyer_id=null where id=sale.id;
    else
      delete from public.bids where auction_id=sale.id and bidder_id=p_user_id;
      update public.auctions set buyer_id=null,current_price=starting_price,
        ends_at=case when ends_at<clock_timestamp()+interval '3 minutes' then greatest(ends_at,clock_timestamp()+interval '5 minutes') else ends_at end
        where id=sale.id;
    end if;
  end loop;
  update public.trade_offers set status='cancelled',updated_at=clock_timestamp()
    where status='pending' and (from_user=p_user_id or to_user=p_user_id);
  select coalesce(array_agg(id),'{}') into owned_ids from public.user_cards where user_id=p_user_id;
  update public.auctions a set card_snapshot=jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
    'rarity',c.rarete_base,'image',c.image_url,'catalogueImage',c.image_url,'shiny',uc.is_shiny)
    from public.user_cards uc join public.cards c on c.id=uc.card_id
    where uc.id=a.card_instance_id and (uc.user_id=p_user_id or a.seller_id=p_user_id or a.buyer_id=p_user_id);
  update public.trade_offers o set
    offered_cards_snapshot=coalesce(offered_cards_snapshot,(select coalesce(jsonb_agg(v - 'folderId' - 'obtainedAt' - 'customImageUrl' || jsonb_build_object('image',v->'catalogueImage')),'[]') from jsonb_array_elements(public.trade_card_json(o.offered_card_ids)) v)),
    requested_cards_snapshot=coalesce(requested_cards_snapshot,(select coalesce(jsonb_agg(v - 'folderId' - 'obtainedAt' - 'customImageUrl' || jsonb_build_object('image',v->'catalogueImage')),'[]') from jsonb_array_elements(public.trade_card_json(o.requested_card_ids)) v))
    where from_user=p_user_id or to_user=p_user_id or offered_card_ids&&owned_ids or requested_card_ids&&owned_ids;
  -- Structured and free-form report payloads can contain names, emails or bio.
  update public.admin_audit_logs set metadata='{}',card_snapshot=null where admin_user_id=p_user_id
    or position(p_user_id::text in metadata::text)>0
    or metadata->>'report_id' in (select id::text from public.user_reports where reporter_id=p_user_id or reported_id=p_user_id);
  update public.user_reports set snapshot='{}',details='' where reporter_id=p_user_id or reported_id=p_user_id;
  update public.auctions set seller_id=null where seller_id=p_user_id;
  update public.auctions set buyer_id=null where buyer_id=p_user_id;
  update public.bids set bidder_id=null where bidder_id=p_user_id;
  update public.trade_offers set from_user=null where from_user=p_user_id;
  update public.trade_offers set to_user=null where to_user=p_user_id;
  update public.user_reports set reporter_id=null where reporter_id=p_user_id;
  update public.user_reports set reported_id=null where reported_id=p_user_id;
  update public.card_reports set reporter_id=null where reporter_id=p_user_id;
  update public.admin_audit_logs set admin_user_id=null where admin_user_id=p_user_id;
  delete from public.profile_wall_posts where user_id=p_user_id;
  -- Remove messages/notifications/shares rather than retaining personal text.
  delete from public.notifications where user_id=p_user_id or actor_user_id=p_user_id;
  delete from public.auction_chat_messages where user_id=p_user_id;
  delete from public.card_shares where owner_id=p_user_id;
  delete from public.card_share_creations where owner_id=p_user_id;
  delete from public.friendships where user_id=p_user_id or friend_id=p_user_id;
  delete from public.user_blocks where blocker_id=p_user_id or blocked_id=p_user_id;
  delete from public.auction_watchers where user_id=p_user_id;
  delete from public.decision_packs where user_id=p_user_id;
  update public.user_cards set is_locked=false where user_id=p_user_id and is_locked;
  delete from public.user_cards where user_id=p_user_id;
  delete from public.folders where user_id=p_user_id;
  delete from public.wishlists where user_id=p_user_id;
  delete from public.user_achievements where user_id=p_user_id;
  delete from public.user_achievement_stats where user_id=p_user_id;
  delete from public.admin_users where user_id=p_user_id;
  update public.admin_users set granted_by=null where granted_by=p_user_id;
  delete from public.user_profiles where user_id=p_user_id;
  -- No DELETE on auth.users or storage.objects: their APIs own physical deletion.
  return objects;
end; $$;

create or replace function public.build_data_export(p_user_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  -- All data, Auth and avatar metadata included, are read by this ONE statement.
  -- Projections are explicit; unknown columns and snapshot properties never enter the result.
  with permitted as materialized (
    select exists(select 1 from public.data_export_state s where s.user_id=p_user_id and s.request_id=p_request_id
      and s.reserved_at>statement_timestamp()-interval '5 minutes') reserved,
      exists(select 1 from public.account_deletion_log where user_id=p_user_id) deleted
  ), rows as materialized (
    select 'account'::text section, value from (select jsonb_build_object('id',t.id,'email',to_jsonb(t)->'email','phone',to_jsonb(t)->'phone','created_at',to_jsonb(t)->'created_at','updated_at',to_jsonb(t)->'updated_at','email_confirmed_at',to_jsonb(t)->'email_confirmed_at','phone_confirmed_at',to_jsonb(t)->'phone_confirmed_at','is_admin',exists(select 1 from public.admin_users a where a.user_id=p_user_id)) value from auth.users t where t.id=p_user_id limit 100001) bounded
    union all
    select 'wall_posts'::text section,value from (select jsonb_build_object('id',t.id,'text',t.body,'gif_url',t.gif_url,'has_image',t.media_path is not null,'created_at',t.created_at) value from public.profile_wall_posts t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'wall_files'::text section,value from (select jsonb_build_object('type',to_jsonb(t)->'metadata'->'mimetype','size',to_jsonb(t)->'metadata'->'size') value from storage.objects t where t.bucket_id='profile-wall-media' and split_part(t.name,'/',1)=p_user_id::text limit 100001) bounded
    union all
    select 'profile'::text section, value from (select jsonb_build_object('pseudo',t.pseudo,'next_regular_pack_at',t.next_regular_pack_at,'next_decision_pack_at',t.next_decision_pack_at,'karas_balance',t.karas_balance,'avatar_url',case when t.avatar_url ~ '^https://[^/@?#]+/' then regexp_replace(t.avatar_url, '[?#].*$', '') else null end,'bio',t.bio,'featured_card_ids',t.featured_card_ids,'banner_card_id',t.banner_card_id,'is_public',t.is_public,'last_seen_at',t.last_seen_at,'presence_active',t.presence_active,'interests',t.interests,'profile_widgets',t.profile_widgets,'banner_url',case when t.banner_url ~ '^https://[^/@?#]+/' then regexp_replace(t.banner_url,'[?#].*$','') else null end) value from public.user_profiles t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'progress'::text section, value from (select jsonb_build_object('regular_packs_opened', t.regular_packs_opened, 'decision_packs_completed', t.decision_packs_completed, 'auctions_won', t.auctions_won, 'trades_completed', t.trades_completed, 'ssr_evolved_to_lr', t.ssr_evolved_to_lr) value from public.user_achievement_stats t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'profile_likes_sent'::text section,value from (select jsonb_build_object('profile',(select pseudo from public.user_profiles where user_id=t.owner_id),'created_at',t.created_at) value from public.profile_likes t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'profile_visits'::text section,value from (select jsonb_build_object('profile',(select pseudo from public.user_profiles where user_id=t.owner_id),'views',t.views,'last_visited_at',t.last_visited_at) value from public.profile_visit_receipts t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'profile_engagement'::text section,jsonb_build_object('views',coalesce((select sum(views) from public.profile_visit_receipts where owner_id=p_user_id),0),'likes',(select count(*) from public.profile_likes where owner_id=p_user_id))
    union all
    select 'collection'::text section, value from (select jsonb_build_object('id', t.id, 'card_id', t.card_id, 'date_obtention', t.date_obtention, 'rarity', t.rarity, 'is_shiny', t.is_shiny, 'is_evolved', t.is_evolved, 'folder_id', t.folder_id, 'is_first_owner', t.is_first_owner, 'is_locked', t.is_locked) || jsonb_build_object('custom_image_url',case when t.custom_image_url ~ '^https://[^/@?#]+/' then regexp_replace(t.custom_image_url, '[?#].*$', '') else null end) value from public.user_cards t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'folders'::text section, value from (select jsonb_build_object('id', t.id, 'nom', t.nom, 'created_at', t.created_at) value from public.folders t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'wishlist'::text section, value from (select jsonb_build_object('card_id', t.card_id, 'created_at', t.created_at) value from public.wishlists t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'album_favorites'::text section, value from (select jsonb_build_object('license', t.license, 'created_at', t.created_at) value from public.panini_album_favorites t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'decision_packs'::text section, value from (select jsonb_build_object('id', t.id, 'status', t.status, 'created_at', t.created_at, 'claimed_at', t.claimed_at, 'kept_choice_id', t.kept_choice_id) value from public.decision_packs t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'achievements'::text section, value from (select jsonb_build_object('achievement_id', t.achievement_id, 'completed_at', t.completed_at, 'claimed_at', t.claimed_at) value from public.user_achievements t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'watched_auctions'::text section, value from (select jsonb_build_object('auction_id', t.auction_id) value from public.auction_watchers t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'messages'::text section, value from (select jsonb_build_object('id', t.id, 'auction_id', t.auction_id, 'message', t.message, 'gif_url', t.gif_url, 'created_at', t.created_at) value from public.auction_chat_messages t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'decision_pack_choices'::text section, value from (select jsonb_build_object('id', t.id, 'pack_id', t.pack_id, 'card_id', t.card_id, 'rarity', t.rarity, 'is_shiny', t.is_shiny, 'is_discarded', t.is_discarded, 'position', t.position) value from public.decision_pack_choices t join public.decision_packs p on p.id=t.pack_id where p.user_id=p_user_id limit 100001) bounded
    union all
    select 'bids'::text section, value from (select jsonb_build_object('id', t.id, 'auction_id', t.auction_id, 'amount', t.amount, 'created_at', t.created_at) value from public.bids t where t.bidder_id=p_user_id limit 100001) bounded
    union all
    select 'auctions'::text section, value from (select jsonb_build_object('id', t.id, 'starting_price', t.starting_price, 'duration_minutes', t.duration_minutes, 'ends_at', t.ends_at, 'status', t.status, 'created_at', t.created_at) || jsonb_build_object('role',case when t.seller_id=p_user_id then 'seller' when t.buyer_id=p_user_id then 'buyer' else 'bidder' end,'own_result_amount',case when t.status='sold' and p_user_id in(t.seller_id,t.buyer_id) then t.current_price else null end,'counterparty',jsonb_build_object('pseudo',(select p.pseudo from public.user_profiles p where p.user_id=case when t.seller_id=p_user_id then t.buyer_id else t.seller_id end),'date',t.created_at)) value from public.auctions t where t.seller_id=p_user_id or t.buyer_id=p_user_id or exists(select 1 from public.bids b where b.auction_id=t.id and b.bidder_id=p_user_id) limit 100001) bounded
    union all
    select 'trades'::text section, value from (select jsonb_build_object('id', t.id, 'status', t.status, 'created_at', t.created_at, 'updated_at', t.updated_at) || jsonb_build_object('direction',case when t.from_user=p_user_id then 'sent' else 'received' end,'own_card_ids',case when t.from_user=p_user_id then t.offered_card_ids else t.requested_card_ids end,'own_karas',case when t.from_user=p_user_id then t.offered_karas else t.requested_karas end,'own_cards',coalesce((select jsonb_agg(jsonb_build_object('card_id',v->'id','name',v->'name','category',v->'category','rarity',v->'rarity','shiny',v->'shiny')) from jsonb_array_elements(case when jsonb_typeof(case when t.from_user=p_user_id then t.offered_cards_snapshot else t.requested_cards_snapshot end)='array' then case when t.from_user=p_user_id then t.offered_cards_snapshot else t.requested_cards_snapshot end else '[]'::jsonb end) v),'[]'::jsonb),'parent_offer_id',case when exists(select 1 from public.trade_offers parent where parent.id=t.parent_offer_id and (parent.from_user=p_user_id or parent.to_user=p_user_id)) then t.parent_offer_id else null end,'counterparty',jsonb_build_object('pseudo',(select p.pseudo from public.user_profiles p where p.user_id=case when t.from_user=p_user_id then t.to_user else t.from_user end),'date',t.created_at)) value from public.trade_offers t where t.from_user=p_user_id or t.to_user=p_user_id limit 100001) bounded
    union all
    select 'friendships'::text section, value from (select jsonb_build_object('id', t.id, 'status', t.status, 'created_at', t.created_at, 'updated_at', t.updated_at) || jsonb_build_object('direction',case when t.user_id=p_user_id then 'sent' else 'received' end,'counterparty',jsonb_build_object('pseudo',(select p.pseudo from public.user_profiles p where p.user_id=case when t.user_id=p_user_id then t.friend_id else t.user_id end),'date',t.created_at)) value from public.friendships t where t.user_id=p_user_id or t.friend_id=p_user_id limit 100001) bounded
    union all
    select 'blocks'::text section, value from (select jsonb_build_object('pseudo',(select p.pseudo from public.user_profiles p where p.user_id=t.blocked_id),'created_at',t.created_at) value from public.user_blocks t where t.blocker_id=p_user_id limit 100001) bounded
    union all
    select 'submitted_reports'::text section, value from (select jsonb_build_object('id', t.id, 'reason', t.reason, 'context_type', t.context_type, 'created_at', t.created_at) value from public.user_reports t where t.reporter_id=p_user_id limit 100001) bounded
    union all
    select 'submitted_card_reports'::text section, value from (select jsonb_build_object('id', t.id, 'card_id', t.card_id, 'reason', t.reason, 'created_at', t.created_at) value from public.card_reports t where t.reporter_id=p_user_id limit 100001) bounded
    union all
    select 'notifications'::text section, value from (select jsonb_build_object('id', t.id, 'type', t.type, 'read_at', t.read_at, 'created_at', t.created_at, 'achievement_id', t.achievement_id) || jsonb_build_object('reference_id',case when exists(select 1 from public.auctions a where a.id=t.reference_id and (a.seller_id=p_user_id or a.buyer_id=p_user_id or exists(select 1 from public.bids b where b.auction_id=a.id and b.bidder_id=p_user_id))) or exists(select 1 from public.trade_offers o where o.id=t.reference_id and (o.from_user=p_user_id or o.to_user=p_user_id)) or exists(select 1 from public.friendships f where f.id=t.reference_id and (f.user_id=p_user_id or f.friend_id=p_user_id)) then t.reference_id else null end,'actor',case when t.actor_user_id is not null and t.actor_user_id<>p_user_id then jsonb_build_object('pseudo',(select p.pseudo from public.user_profiles p where p.user_id=t.actor_user_id),'date',t.created_at) else null end) value from public.notifications t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'card_shares'::text section, value from (select jsonb_build_object('card_id', t.card_id, 'card_name', t.card_name, 'franchise', t.franchise, 'rarity', t.rarity, 'shiny', t.shiny, 'show_pseudo', t.show_pseudo, 'display_pseudo', t.display_pseudo, 'created_at', t.created_at) || jsonb_build_object('catalogue_image_url',case when t.catalogue_image_url ~ '^https://[^/@?#]+/' then regexp_replace(t.catalogue_image_url, '[?#].*$', '') else null end) value from public.card_shares t where t.owner_id=p_user_id limit 100001) bounded
    union all
    select 'login_providers'::text section, value from (select jsonb_build_object('provider', t.provider, 'created_at', t.created_at, 'updated_at', t.updated_at) value from auth.identities t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'avatar_files'::text section, value from (select jsonb_build_object('type',case when jsonb_typeof(to_jsonb(t)->'metadata'->'mimetype')='string' then to_jsonb(t)->'metadata'->'mimetype' else null end,'size',case when (to_jsonb(t)->'metadata'->>'size') ~ '^[0-9]{1,15}$' then (to_jsonb(t)->'metadata'->>'size')::bigint else null end,'created_at',to_jsonb(t)->'created_at','updated_at',to_jsonb(t)->'updated_at','last_accessed_at',to_jsonb(t)->'last_accessed_at') value from storage.objects t where t.bucket_id='avatars' and (t.owner_id=p_user_id::text or to_jsonb(t)->>'owner'=p_user_id::text or split_part(t.name,'/',1)=p_user_id::text) limit 100001) bounded
    union all
    select 'catalogue_cards'::text section, value from (select jsonb_build_object('id',t.id,'name',t.nom,'category',t.categorie,'rarity',t.rarete_base,'franchises',coalesce((select jsonb_agg(f.franchise order by f.position) from public.card_franchises f where f.card_id=t.id),'[]'::jsonb)) value from public.cards t where exists(select 1 from public.user_cards c where c.user_id=p_user_id and c.card_id=t.id) or exists(select 1 from public.wishlists w where w.user_id=p_user_id and w.card_id=t.id) or exists(select 1 from public.decision_pack_choices c join public.decision_packs p on p.id=c.pack_id where p.user_id=p_user_id and c.card_id=t.id) or exists(select 1 from public.user_profiles p where p.user_id=p_user_id and p.banner_card_id=t.id) limit 100001) bounded
  ), size as (
    select count(*) n,coalesce(sum(octet_length(value::text)+2),0)+8192 bytes from rows
  ), sections as (
    select section,case when section in('account','profile','progress','profile_engagement') then (jsonb_agg(value)->0)
      else jsonb_agg(value order by value::text) end value from rows group by section
  )
  select case when (select deleted from permitted) then '{"error":"ACCOUNT_DELETED"}'::jsonb
    when not (select reserved from permitted) then '{"error":"EXPORT_RESERVATION_REQUIRED"}'::jsonb
    when (select n>100000 or bytes>26214400 from size) then '{"error":"EXPORT_TOO_LARGE"}'::jsonb
    else jsonb_build_object('schema_version',1,'exported_at',statement_timestamp(),
      'catalogue_cards','[]'::jsonb,
      'account',null,
      'profile',null,
      'wall_posts','[]'::jsonb,
      'wall_files','[]'::jsonb,
      'profile_engagement',null,
      'profile_likes_sent','[]'::jsonb,
      'profile_visits','[]'::jsonb,
      'progress',null,
      'collection','[]'::jsonb,
      'folders','[]'::jsonb,
      'wishlist','[]'::jsonb,
      'album_favorites','[]'::jsonb,
      'decision_packs','[]'::jsonb,
      'achievements','[]'::jsonb,
      'watched_auctions','[]'::jsonb,
      'messages','[]'::jsonb,
      'decision_pack_choices','[]'::jsonb,
      'bids','[]'::jsonb,
      'auctions','[]'::jsonb,
      'trades','[]'::jsonb,
      'friendships','[]'::jsonb,
      'blocks','[]'::jsonb,
      'submitted_reports','[]'::jsonb,
      'submitted_card_reports','[]'::jsonb,
      'notifications','[]'::jsonb,
      'card_shares','[]'::jsonb,
      'login_providers','[]'::jsonb,
      'avatar_files','[]'::jsonb)
      || coalesce((select jsonb_object_agg(section,value) from sections),'{}'::jsonb)
    end into result;
  if result ? 'error' then raise exception '%',result->>'error'; end if;
  if octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
  return result;
end; $$;

commit;
