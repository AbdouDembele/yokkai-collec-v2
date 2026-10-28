begin;

set local lock_timeout = '5s';
set local statement_timeout = '10s';

-- Catalogue-only snapshots retain history without keeping profile/custom images.
alter table public.auctions add column card_snapshot jsonb;
alter table public.trade_offers add column offered_cards_snapshot jsonb, add column requested_cards_snapshot jsonb;

create function public.guard_deleted_account()
returns trigger language plpgsql security definer set search_path='' as $$
declare player uuid:=auth.uid(); referenced uuid;
begin
  if player is not null then
    if exists(select 1 from public.account_deletion_log where user_id=player) then raise exception 'ACCOUNT_DELETED' using errcode='P0001'; end if;
    -- Shared until commit. The deletion fence waits for in-flight player writes,
    -- without holding auction/profile locks or changing their existing order.
    perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||player::text,0));
    if exists(select 1 from public.account_deletion_log where user_id=player) then raise exception 'ACCOUNT_DELETED' using errcode='P0001'; end if;
  end if;
  if tg_level='ROW' and player is not null then
    for referenced in select distinct value::uuid from jsonb_each_text(to_jsonb(new))
      where key=any(array['user_id','friend_id','seller_id','buyer_id','from_user','to_user','reporter_id','reported_id','admin_user_id','actor_user_id','owner_id','blocker_id','blocked_id','granted_by'])
      and value<>player::text
      and value ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      order by value::uuid loop
      -- A row trigger may already hold its row lock. Once the fence is committed,
      -- refuse before waiting on cleanup's exclusive advisory lock.
      if exists(select 1 from public.account_deletion_log where user_id=referenced) then
        raise exception 'ACCOUNT_DELETED' using errcode='P0001';
      end if;
      perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||referenced::text,0));
      if exists(select 1 from public.account_deletion_log where user_id=referenced) then
        raise exception 'ACCOUNT_DELETED' using errcode='P0001';
      end if;
    end loop;
  end if;
  if tg_level='ROW' then return new; end if;
  return null;
end; $$;
revoke all on function public.guard_deleted_account() from public,anon,authenticated;

do $$ declare target record; begin
  for target in select schemaname,tablename from pg_tables where schemaname='public' loop
    execute format('create trigger account_deletion_write_guard before insert or update or delete on %I.%I for each statement execute function public.guard_deleted_account()',target.schemaname,target.tablename);
    if exists(select 1 from pg_constraint where contype='f' and confrelid='auth.users'::regclass
      and conrelid=format('%I.%I',target.schemaname,target.tablename)::regclass) then
      execute format('create trigger account_deletion_reference_guard before insert or update on %I.%I for each row execute function public.guard_deleted_account()',target.schemaname,target.tablename);
    end if;
  end loop;
end; $$;
create trigger account_deletion_write_guard before insert or update or delete on storage.objects
  for each statement execute function public.guard_deleted_account();
create function public.begin_account_deletion(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_user_id is null then raise exception 'INVALID_ACCOUNT' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user_id::text,0));
  -- Never erase catalogue/global assets as part of personal account removal.
  if exists(select 1 from storage.objects o where o.bucket_id<>'avatars'
    and (o.owner_id=p_user_id::text or to_jsonb(o)->>'owner'=p_user_id::text)) then
    raise exception 'STORAGE_OWNERSHIP_REQUIRES_REVIEW' using errcode='P0001';
  end if;
  insert into public.account_deletion_log(user_id) values(p_user_id) on conflict do nothing;
end; $$;
revoke all on function public.begin_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.begin_account_deletion(uuid) to service_role;

create function public.prepare_account_deletion(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sale record; owned_ids uuid[]; objects jsonb;
begin
  if p_user_id is null or not exists(select 1 from public.account_deletion_log where user_id=p_user_id) then
    raise exception 'ACCOUNT_DELETION_NOT_STARTED' using errcode='P0001';
  end if;
  -- Serialize retries of the same deletion, after the committed fence.
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user_id::text,0));
  if exists(select 1 from storage.objects o where o.bucket_id<>'avatars'
    and (o.owner_id=p_user_id::text or to_jsonb(o)->>'owner'=p_user_id::text)) then
    raise exception 'STORAGE_OWNERSHIP_REQUIRES_REVIEW' using errcode='P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'name',o.name) order by o.name),'[]') into objects
    from storage.objects o where o.bucket_id='avatars' and
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
revoke all on function public.prepare_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

-- Keep legacy RPC signatures and page ordering for cached frontends.
create or replace function public.list_auctions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare player_id uuid := auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (with player_bids as materialized (select distinct b.auction_id from public.bids b where b.bidder_id=player_id)
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'card',case when c.id is not null then jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
        'rarity',c.rarete_base,'image',c.image_url,'catalogueImage',c.image_url,'shiny',uc.is_shiny) else a.card_snapshot end,
      'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',coalesce(p.pseudo,'Joueur supprimé'),'sellerId',a.seller_id,
      'sellerAvatarUrl',p.avatar_url,'buyerId',a.buyer_id,'hasBid',pb.auction_id is not null,
      'popularity',coalesce(c.favoris_count,0),'bids',(select count(*) from public.bids b where b.auction_id=a.id),
      'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
    ) order by a.ends_at),'[]'::jsonb)
    from public.auctions a left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id left join public.user_profiles p on p.user_id=a.seller_id
    left join player_bids pb on pb.auction_id=a.id
    where (c.id is not null or a.card_snapshot is not null) and (a.status='active' or a.seller_id=player_id or a.buyer_id=player_id or pb.auction_id is not null));
end; $$;

create or replace function public.get_auction(p_auction_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare player_id uuid := auth.uid(); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select jsonb_build_object('id',a.id,'card',case when c.id is not null then jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,
    'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url,'catalogueImage',c.image_url,'shiny',uc.is_shiny) else a.card_snapshot end,
    'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',coalesce(p.pseudo,'Joueur supprimé'),'sellerId',a.seller_id,
    'sellerAvatarUrl',p.avatar_url,'buyerId',a.buyer_id,'bids',(select count(*) from public.bids b where b.auction_id=a.id),
    'winner',case when a.status='sold' then coalesce((select pseudo from public.user_profiles where user_id=a.buyer_id),'Joueur supprimé') else (select pseudo from public.user_profiles where user_id=a.buyer_id) end,
    'balance',(select karas_balance from public.user_profiles where user_id=player_id),
    'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',coalesce(bp.pseudo,'Joueur supprimé'),'avatarUrl',bp.avatar_url,
      'amount',b.amount,'createdAt',b.created_at,'mine',b.bidder_id=player_id) order by b.created_at desc),'[]'::jsonb)
      from public.bids b left join public.user_profiles bp on bp.user_id=b.bidder_id where b.auction_id=a.id)) into result
    from public.auctions a left join public.user_cards uc on uc.id=a.card_instance_id left join public.cards c on c.id=uc.card_id
    left join public.user_profiles p on p.user_id=a.seller_id where a.id=p_auction_id and (c.id is not null or a.card_snapshot is not null);
  if result is null then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;

create or replace function public.list_auctions_page(p_cursor jsonb default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); page_size integer:=least(p_limit,100);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_limit is null or p_limit<1 then raise exception 'INVALID_PAGE_SIZE' using errcode='P0001'; end if;
  return (with player_bids as materialized (select distinct b.auction_id from public.bids b where b.bidder_id=player_id),
  selected as materialized (
    select a.*,uc.is_shiny,c.id card_id,c.nom,c.categorie,c.franchise,c.rarete_base,c.image_url,c.favoris_count,
      p.pseudo,p.avatar_url,pb.auction_id is not null has_bid
    from public.auctions a left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id left join public.user_profiles p on p.user_id=a.seller_id
    left join player_bids pb on pb.auction_id=a.id
    where (c.id is not null or a.card_snapshot is not null) and (a.status='active' or a.seller_id=player_id or a.buyer_id=player_id or pb.auction_id is not null)
      and (p_cursor is null or (a.created_at,a.id)>((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
    -- Immutable cursor: anti-sniping changes ends_at, never created_at.
    order by a.created_at,a.id limit page_size
  ) select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'card',case when a.card_id is not null then jsonb_build_object('id',a.card_id,'name',a.nom,'category',a.categorie,'anime',a.franchise,
        'rarity',a.rarete_base,'image',a.image_url,'catalogueImage',a.image_url,'shiny',a.is_shiny) else a.card_snapshot end,
      'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',coalesce(a.pseudo,'Joueur supprimé'),'sellerId',a.seller_id,
      'sellerAvatarUrl',a.avatar_url,'buyerId',a.buyer_id,'hasBid',a.has_bid,'popularity',coalesce(a.favoris_count,0),
      'bids',(select count(*) from public.bids b where b.auction_id=a.id),
      'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
    ) order by a.created_at,a.id),'[]'::jsonb),
    'nextCursor',case when count(*)=page_size then
      jsonb_agg(jsonb_build_object('createdAt',a.created_at,'id',a.id) order by a.created_at desc,a.id desc)->0 end
  ) from selected a);
end; $$;

create or replace function public.list_trade_offers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'fromUser',o.from_user,'toUser',o.to_user,
    'incoming',o.to_user=player_id,'fromPseudo',coalesce(fp.pseudo,'Joueur supprimé'),'fromAvatarUrl',fp.avatar_url,
    'toPseudo',coalesce(tp.pseudo,'Joueur supprimé'),'toAvatarUrl',tp.avatar_url,'offeredCards',coalesce(o.offered_cards_snapshot,public.trade_card_json(o.offered_card_ids)),
    'offeredKaras',o.offered_karas,'requestedCards',coalesce(o.requested_cards_snapshot,public.trade_card_json(o.requested_card_ids)),
    'requestedKaras',o.requested_karas,'status',o.status,'parentOfferId',o.parent_offer_id,'createdAt',o.created_at)
    order by o.created_at desc),'[]'::jsonb) from public.trade_offers o
    left join public.user_profiles fp on fp.user_id=o.from_user left join public.user_profiles tp on tp.user_id=o.to_user
    where o.from_user=player_id or o.to_user=player_id);
end; $$;

create or replace function public.list_trade_offers_page(p_cursor jsonb default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); page_size integer:=least(p_limit,100);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_limit is null or p_limit<1 then raise exception 'INVALID_PAGE_SIZE' using errcode='P0001'; end if;
  return (with selected as materialized (
    select o.*,fp.pseudo from_pseudo,fp.avatar_url from_avatar,tp.pseudo to_pseudo,tp.avatar_url to_avatar
    from public.trade_offers o
    left join public.user_profiles fp on fp.user_id=o.from_user left join public.user_profiles tp on tp.user_id=o.to_user
    where (o.from_user=player_id or o.to_user=player_id)
      and (p_cursor is null or (o.created_at,o.id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
    order by o.created_at desc,o.id desc limit page_size
  ) select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,'fromUser',o.from_user,'toUser',o.to_user,'incoming',o.to_user=player_id,
      'fromPseudo',coalesce(o.from_pseudo,'Joueur supprimé'),'fromAvatarUrl',o.from_avatar,'toPseudo',coalesce(o.to_pseudo,'Joueur supprimé'),'toAvatarUrl',o.to_avatar,
      'offeredCards',coalesce(o.offered_cards_snapshot,public.trade_card_json(o.offered_card_ids)),'offeredKaras',o.offered_karas,
      'requestedCards',coalesce(o.requested_cards_snapshot,public.trade_card_json(o.requested_card_ids)),'requestedKaras',o.requested_karas,
      'status',o.status,'parentOfferId',o.parent_offer_id,'createdAt',o.created_at
    ) order by o.created_at desc,o.id desc),'[]'::jsonb),
    'nextCursor',case when count(*)=page_size then
      jsonb_agg(jsonb_build_object('createdAt',o.created_at,'id',o.id) order by o.created_at,o.id)->0 end
  ) from selected o);
end; $$;

create or replace function public.admin_search_reports(p_status text default null,p_query text default '',p_limit integer default 30,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  query text:=left(btrim(coalesce(p_query,'')),100);
  safe_limit integer:=least(greatest(coalesce(p_limit,30),1),100);
  safe_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is not null and p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  return (
    with matching as (
      select r.*,case when r.reporter_id is null then 'Joueur supprimé' else coalesce(reporter.pseudo,split_part(coalesce(reporter_auth.email,'Joueur'),'@',1),'Joueur') end reporter_pseudo,
        coalesce(reporter_auth.email,'') reporter_email,
        case when r.reported_id is null then 'Joueur supprimé' else coalesce(reported.pseudo,split_part(coalesce(reported_auth.email,'Joueur'),'@',1),'Joueur') end reported_pseudo,
        coalesce(reported_auth.email,'') reported_email,
        reported_auth.banned_until is not null and reported_auth.banned_until>now() reported_is_banned
      from public.user_reports r
      left join auth.users reporter_auth on reporter_auth.id=r.reporter_id
      left join auth.users reported_auth on reported_auth.id=r.reported_id
      left join public.user_profiles reporter on reporter.user_id=r.reporter_id
      left join public.user_profiles reported on reported.user_id=r.reported_id
      where (p_status is null or r.status=p_status) and (query='' or
        reporter.pseudo ilike '%'||query||'%' or reporter_auth.email ilike '%'||query||'%' or
        reported.pseudo ilike '%'||query||'%' or reported_auth.email ilike '%'||query||'%')
    ), page as (
      select * from matching order by created_at desc,id desc limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'total',(select count(*) from matching),
      'reports',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'reporterId',reporter_id,'reporterPseudo',reporter_pseudo,'reporterEmail',reporter_email,
        'reportedId',reported_id,'reportedPseudo',reported_pseudo,'reportedEmail',reported_email,'reportedIsBanned',reported_is_banned,
        'reason',reason,'contextType',context_type,'contextId',context_id,'snapshot',snapshot,'details',details,'status',status,'createdAt',created_at
      ) order by created_at desc,id desc) from page),'[]'::jsonb)
    )
  );
end; $$;

create or replace function public.admin_search_card_reports(p_status text default null,p_query text default '',p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  query text:=left(btrim(coalesce(p_query,'')),100);
  safe_limit integer:=least(greatest(coalesce(p_limit,100),1),100);
  safe_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_status is not null and p_status not in ('pending','reviewed','dismissed') then raise exception 'REPORT_INVALID' using errcode='P0001'; end if;
  return (
    with matching as (
      select r.*,case when r.reporter_id is null then 'Joueur supprimé' else coalesce(reporter.pseudo,split_part(coalesce(reporter_auth.email,'Joueur'),'@',1),'Joueur') end reporter_pseudo,
        coalesce(reporter_auth.email,'') reporter_email,c.nom card_name,c.franchise,c.image_url,c.rarete_base
      from public.card_reports r
      left join auth.users reporter_auth on reporter_auth.id=r.reporter_id
      left join public.user_profiles reporter on reporter.user_id=r.reporter_id
      left join public.cards c on c.id=r.card_id
      where (p_status is null or r.status=p_status) and (query='' or
        reporter.pseudo ilike '%'||query||'%' or reporter_auth.email ilike '%'||query||'%' or
        c.nom ilike '%'||query||'%' or c.franchise ilike '%'||query||'%')
    ), page as (
      select * from matching order by created_at desc,id desc limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'total',(select count(*) from matching),
      'reports',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'reporterId',reporter_id,'reporterPseudo',reporter_pseudo,'reporterEmail',reporter_email,
        'cardId',card_id,'cardName',coalesce(card_name,snapshot->>'name','Carte supprimée'),
        'franchise',coalesce(franchise,snapshot->>'franchise',''),'imageUrl',coalesce(image_url,snapshot->>'imageUrl',''),
        'rarity',coalesce(rarete_base::text,snapshot->>'rarity',''),'reason',reason,'snapshot',snapshot,
        'status',status,'createdAt',created_at
      ) order by created_at desc,id desc) from page),'[]'::jsonb)
    )
  );
end; $$;

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg((jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',coalesce(n.reference_id::text,n.achievement_id),'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'achievementName',achievement.titre,
      'actorPseudo',coalesce(mention_actor.pseudo,friend_sender.pseudo,trade_actor.pseudo,case when n.type in ('auction_chat_mention','friend_request','trade_offer_received','trade_counter_offer_received','trade_offer_accepted','trade_offer_declined','trade_offer_cancelled') then 'Joueur supprimé' end)
    ) || case when n.type='auction_sold' then jsonb_build_object('karaAmount',a.current_price) else '{}'::jsonb end)
      order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id and not public.users_blocked(player_id,public.interaction_notification_actor(notifications)) order by created_at desc limit safe_limit) n
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

commit;
