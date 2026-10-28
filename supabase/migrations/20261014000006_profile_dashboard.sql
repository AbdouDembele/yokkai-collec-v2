begin;

alter table public.user_profiles add column interests jsonb not null default
  '{"anime":[],"games":[],"kpop":[],"other":[]}'::jsonb;
alter table public.user_profiles add column profile_widgets jsonb not null default '[]'::jsonb;
alter table public.user_profiles add column banner_url text;

create table public.profile_likes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id,user_id), check (owner_id <> user_id)
);
-- One bounded receipt per visitor/profile pair, not an unbounded log per page load.
create table public.profile_visit_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  visit_ids uuid[] not null check (cardinality(visit_ids) between 1 and 64),
  views bigint not null default 1 check (views > 0),
  last_visited_at timestamptz not null default now(),
  primary key (owner_id,user_id), check (owner_id <> user_id)
);
create index profile_likes_sender_idx on public.profile_likes(user_id);
create index profile_visits_sender_idx on public.profile_visit_receipts(user_id);
alter table public.profile_likes enable row level security;
alter table public.profile_visit_receipts enable row level security;
revoke all on public.profile_likes,public.profile_visit_receipts from public,anon,authenticated;
grant all on public.profile_likes,public.profile_visit_receipts to service_role;
create trigger account_deletion_write_guard before insert or update or delete on public.profile_likes
  for each statement execute function public.guard_deleted_account();
create trigger account_deletion_reference_guard before insert or update on public.profile_likes
  for each row execute function public.guard_deleted_account();
create trigger account_deletion_write_guard before insert or update or delete on public.profile_visit_receipts
  for each statement execute function public.guard_deleted_account();
create trigger account_deletion_reference_guard before insert or update on public.profile_visit_receipts
  for each row execute function public.guard_deleted_account();

create function public.get_profile_engagement(p_owner_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_owner_id is null then raise exception 'INVALID_PROFILE'; end if;
  perform public.get_profile(p_owner_id::text);
  return jsonb_build_object(
    'views',coalesce((select sum(views) from public.profile_visit_receipts where owner_id=p_owner_id),0),
    'likes',(select count(*) from public.profile_likes where owner_id=p_owner_id),
    'likedByMe',exists(select 1 from public.profile_likes where owner_id=p_owner_id and user_id=auth.uid())
  );
end; $$;

create function public.record_profile_view(p_owner_id uuid,p_visit_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := auth.uid();
begin
  perform public.get_profile(p_owner_id::text);
  if viewer = p_owner_id then return public.get_profile_engagement(p_owner_id); end if;
  if p_visit_id is null or p_owner_id is null then raise exception 'INVALID_VISIT'; end if;
  if exists(select 1 from public.user_blocks where
    (blocker_id=viewer and blocked_id=p_owner_id) or (blocker_id=p_owner_id and blocked_id=viewer))
    then raise exception 'PROFILE_BLOCKED'; end if;
  insert into public.profile_visit_receipts as receipts(owner_id,user_id,visit_ids)
  values (p_owner_id,viewer,array[p_visit_id])
  on conflict (owner_id,user_id) do update set
    visit_ids=(array[p_visit_id] || receipts.visit_ids)[1:64],
    views=receipts.views+1,last_visited_at=now()
  where not p_visit_id=any(receipts.visit_ids);
  return public.get_profile_engagement(p_owner_id);
end; $$;

create function public.set_profile_like(p_owner_id uuid,p_liked boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := auth.uid();
begin
  perform public.get_profile(p_owner_id::text);
  if p_owner_id is null or p_liked is null then raise exception 'INVALID_LIKE'; end if;
  if viewer=p_owner_id then raise exception 'SELF_PROFILE_LIKE'; end if;
  if exists(select 1 from public.user_blocks where
    (blocker_id=viewer and blocked_id=p_owner_id) or (blocker_id=p_owner_id and blocked_id=viewer))
    then raise exception 'PROFILE_BLOCKED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profile-like:'||p_owner_id::text,0));
  if p_liked then
    insert into public.profile_likes(owner_id,user_id) values(p_owner_id,viewer) on conflict do nothing;
  else delete from public.profile_likes where owner_id=p_owner_id and user_id=viewer;
  end if;
  return public.get_profile_engagement(p_owner_id);
end; $$;
revoke all on function public.get_profile_engagement(uuid),public.record_profile_view(uuid,uuid),public.set_profile_like(uuid,boolean) from public,anon,authenticated;
grant execute on function public.get_profile_engagement(uuid),public.record_profile_view(uuid,uuid),public.set_profile_like(uuid,boolean) to authenticated;

-- Read-only catalogue access under the caller's existing RLS permissions.
create or replace function public.get_profile_widget_licenses(
  p_category text, p_query text default '', p_offset integer default 0, p_limit integer default 72
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with licenses as materialized (
    select distinct links.franchise license from public.card_franchises links
    join public.cards c on c.id = links.card_id
    where upper(btrim(c.categorie)) = upper(btrim(p_category))
      and strpos(lower(links.franchise),lower(btrim(coalesce(p_query,'')))) > 0
  ), page as (
    select license from licenses order by license
    offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,72),1),72)
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(license order by license) from page),'[]'::jsonb),
    'total',(select count(*) from licenses));
$$;
revoke all on function public.get_profile_widget_licenses(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.get_profile_widget_licenses(text,text,integer,integer) to authenticated;

-- Only the caller's profile can be changed. Entries must be actual category licenses,
-- not free text; the JSON byte cap and per-widget count bound full catalogue titles.
create or replace function public.update_profile_widgets(p_widgets jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare player uuid := auth.uid(); widget jsonb; item jsonb; seen text[] := '{}'; category text;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.get_profile(null);
  if jsonb_typeof(p_widgets) is distinct from 'array' or octet_length(p_widgets::text) > 20000
    then raise exception 'WIDGETS_INVALID'; end if;
  if jsonb_array_length(p_widgets) > 12 then raise exception 'WIDGETS_INVALID'; end if;
  for widget in select value from jsonb_array_elements(p_widgets) loop
    if jsonb_typeof(widget) is distinct from 'object' then raise exception 'WIDGETS_INVALID'; end if;
    if jsonb_typeof(widget->'category') is distinct from 'string'
      or jsonb_typeof(widget->'entries') is distinct from 'array'
      or exists(select 1 from jsonb_object_keys(widget) k where k not in ('category','entries'))
      then raise exception 'WIDGETS_INVALID'; end if;
    category := widget->>'category';
    if category = any(seen) or not exists(select 1 from public.cards c where upper(btrim(c.categorie)) = category)
      then raise exception 'WIDGETS_INVALID'; end if;
    seen := array_append(seen, category);
    if jsonb_array_length(widget->'entries') > 12 then raise exception 'WIDGETS_INVALID'; end if;
    for item in select value from jsonb_array_elements(widget->'entries') loop
      if jsonb_typeof(item) <> 'string' or not exists(
        select 1 from public.card_franchises links join public.cards c on c.id = links.card_id
        where upper(btrim(c.categorie)) = category and links.franchise = (item #>> '{}')
      )
        then raise exception 'WIDGETS_INVALID'; end if;
    end loop;
    if jsonb_array_length(widget->'entries') <> (select count(distinct value) from jsonb_array_elements(widget->'entries'))
      then raise exception 'WIDGETS_INVALID'; end if;
  end loop;
  update public.user_profiles set profile_widgets = p_widgets where user_id = player;
  return p_widgets;
end; $$;

-- Reuse all existing avatar/bio/owned-featured-card checks. Appearance saves atomically.
-- Banners reuse the owner-scoped avatars bucket, with no new public upload policy.
create or replace function public.update_profile_appearance(
  p_bio text, p_avatar_url text, p_featured_card_ids uuid[], p_banner_card_id uuid, p_banner_url text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare player uuid := auth.uid(); banner text := nullif(btrim(p_banner_url),''); result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if banner is not null and (char_length(p_banner_url) > 2048 or banner !~ (
    '^https://api[.]yokkai-collec[.]com/storage/v1/object/public/avatars/' || player::text || '/banner[.](jpg|jpeg|png|webp|gif)([?]v=[0-9]+)?$'
  )) then raise exception 'BANNER_URL_INVALID'; end if;
  result := public.update_profile(p_bio,p_avatar_url,p_featured_card_ids,p_banner_card_id);
  update public.user_profiles set banner_url = banner where user_id = player;
  return result || jsonb_build_object('bannerUrl',banner);
end; $$;

revoke all on function public.update_profile_widgets(jsonb), public.update_profile_appearance(text,text,uuid[],uuid,text) from public, anon, authenticated;
grant execute on function public.update_profile_widgets(jsonb), public.update_profile_appearance(text,text,uuid[],uuid,text) to authenticated;

create or replace function public.update_profile_interests(p_interests jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare player uuid := auth.uid(); section text; item jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.get_profile(null);
  if jsonb_typeof(p_interests) is distinct from 'object'
    or octet_length(p_interests::text) > 12000
    or exists(select 1 from jsonb_object_keys(p_interests) k where k not in ('anime','games','kpop','other'))
  then raise exception 'INTERESTS_INVALID'; end if;
  foreach section in array array['anime','games','kpop','other'] loop
    if jsonb_typeof(p_interests->section) is distinct from 'array'
      then raise exception 'INTERESTS_INVALID'; end if;
    if jsonb_array_length(p_interests->section) > 12 then raise exception 'INTERESTS_INVALID'; end if;
    for item in select value from jsonb_array_elements(p_interests->section) loop
      if jsonb_typeof(item) <> 'string' or char_length(btrim(item #>> '{}')) not between 1 and 100
        then raise exception 'INTERESTS_INVALID'; end if;
    end loop;
  end loop;
  update public.user_profiles set interests = p_interests where user_id = player;
  return p_interests;
end; $$;

create or replace function public.get_profile_details(p_identifier text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare base jsonb; target uuid; allowed boolean; result jsonb;
begin
  base := public.get_profile(p_identifier);
  target := (base->>'id')::uuid;
  allowed := (base->>'canViewCollection')::boolean;
  select jsonb_build_object(
    'joinedAt', (select to_jsonb(u)->>'created_at' from auth.users u where u.id = target),
    'interests', (select interests from public.user_profiles where user_id = target),
    'widgets', (select profile_widgets from public.user_profiles where user_id = target),
    'bannerUrl', (select banner_url from public.user_profiles where user_id = target),
    'widgetCategories', coalesce((select jsonb_agg(category order by category) from
      (select distinct upper(btrim(categorie)) category from public.cards where btrim(categorie) <> '') categories), '[]'::jsonb),
    'boostersOpened', case when allowed then
      coalesce((select regular_packs_opened from public.user_achievement_stats where user_id = target), 0)
      + (select count(*) from public.decision_packs where user_id = target) else null end,
    'lrCount', case when allowed then (select count(*) from public.user_cards where user_id = target and rarity = 'LR') else null end,
    'ssrCount', case when allowed then (select count(*) from public.user_cards where user_id = target and rarity = 'SSR') else null end,
    'mutualFriends', case when (base->>'friendsVisible')::boolean then coalesce((
      select jsonb_agg(friend) from jsonb_array_elements(base->'friends') friend
      where exists(select 1 from public.friendships f where f.status = 'accepted'
        and ((f.user_id = auth.uid() and f.friend_id = (friend->>'id')::uuid)
          or (f.friend_id = auth.uid() and f.user_id = (friend->>'id')::uuid)))
    ), '[]'::jsonb) else '[]'::jsonb end,
    'favoriteAlbums', case when allowed then coalesce((
      select jsonb_agg(album order by album->>'license') from (
        select jsonb_build_object('license', f.license, 'total', count(distinct c.id),
          'owned', count(distinct owned.card_id),
          'percent', round(100.0 * count(distinct owned.card_id) / nullif(count(distinct c.id),0))) album
        from public.panini_album_favorites f
        join public.card_franchises links on links.franchise = f.license
        join public.cards c on c.id = links.card_id
        left join (select distinct card_id from public.user_cards where user_id = target) owned on owned.card_id = c.id
        where f.user_id = target group by f.license
      ) albums
    ), '[]'::jsonb) else '[]'::jsonb end,
    'activity', case when allowed then coalesce((
      select jsonb_agg(entry order by happened_at desc, event_id) from (
        select * from (
          select uc.date_obtention happened_at, uc.id::text event_id,
            jsonb_build_object('id', uc.id, 'kind', 'obtained', 'at', uc.date_obtention,
              'card', public.profile_card_json(c,uc)) entry
          from public.user_cards uc join public.cards c on c.id = uc.card_id
          where uc.user_id = target and not exists(select 1 from public.auctions a
            where a.status = 'sold' and a.buyer_id = target and a.card_instance_id = uc.id
              and a.ends_at <= uc.date_obtention and a.ends_at > uc.date_obtention - interval '5 minutes')
          order by uc.date_obtention desc, uc.id limit 20
        ) acquisitions
        union all
        select * from (
          select a.ends_at happened_at, a.id::text event_id,
            jsonb_build_object('id', a.id, 'kind', case when a.seller_id = target then 'sold' else 'bought' end,
              'at', a.ends_at, 'price', a.current_price, 'card', case when c.id is not null then
                jsonb_build_object('id', c.id, 'name', c.nom, 'category', c.categorie,
                  'anime', c.franchise, 'rarity', c.rarete_base, 'image', c.image_url) else a.card_snapshot end) entry
          from public.auctions a left join public.user_cards uc on uc.id = a.card_instance_id
          left join public.cards c on c.id = uc.card_id
          where a.status = 'sold' and (a.seller_id = target or a.buyer_id = target)
            and (c.id is not null or a.card_snapshot is not null)
          order by a.ends_at desc, a.id limit 20
        ) sales
        order by happened_at desc, event_id limit 20
      ) recent
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end; $$;

revoke all on function public.get_profile_details(text), public.update_profile_interests(jsonb) from public, anon, authenticated;
grant execute on function public.get_profile_details(text), public.update_profile_interests(jsonb) to authenticated;

-- Preserve the explicit export projection and its service-role-only access.
-- New personal preferences must be included in the account's own export.
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
