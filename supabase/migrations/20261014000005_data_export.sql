begin;

-- Minimal coordination only: never stores an export, token from Auth, or public link.
create table public.data_export_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id uuid, reserved_at timestamptz, sending_at timestamptz, sent_at timestamptz
);
alter table public.data_export_state enable row level security;
revoke all on table public.data_export_state from public,anon,authenticated;
grant all on table public.data_export_state to service_role;

create function public.reserve_data_export(p_user_id uuid,p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare state public.data_export_state; stamp timestamptz:=clock_timestamp();
begin
  if p_user_id is null or p_request_id is null or not exists(select 1 from auth.users where id=p_user_id) then raise exception 'AUTH_REQUIRED'; end if;
  -- Same fence as account deletion: no old session may export a closing account.
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||p_user_id::text,0));
  if exists(select 1 from public.account_deletion_log where user_id=p_user_id) then raise exception 'ACCOUNT_DELETED'; end if;
  insert into public.data_export_state(user_id) values(p_user_id) on conflict do nothing;
  select * into state from public.data_export_state where user_id=p_user_id for update;
  if state.sent_at>stamp-interval '24 hours' then
    raise exception 'EXPORT_RATE_LIMITED' using detail=ceil(extract(epoch from state.sent_at+interval '24 hours'-stamp))::text;
  end if;
  if state.sending_at>stamp-interval '24 hours' then raise exception 'EXPORT_IN_PROGRESS'; end if;
  if state.request_id is not null and state.sending_at is null and state.reserved_at>stamp-interval '5 minutes' then raise exception 'EXPORT_IN_PROGRESS'; end if;
  update public.data_export_state set request_id=p_request_id,reserved_at=stamp,sending_at=null where user_id=p_user_id;
end; $$;

create function public.mark_data_export_sending(p_user_id uuid,p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.data_export_state set sending_at=clock_timestamp()
    where user_id=p_user_id and request_id=p_request_id and reserved_at>clock_timestamp()-interval '5 minutes';
  if not found then raise exception 'EXPORT_RESERVATION_REQUIRED'; end if;
end; $$;

create function public.finish_data_export(p_user_id uuid,p_request_id uuid,p_sent boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.data_export_state set sent_at=case when p_sent then clock_timestamp() else sent_at end,
    request_id=null,reserved_at=null,sending_at=null
    where user_id=p_user_id and request_id=p_request_id;
end; $$;

create function public.build_data_export(p_user_id uuid,p_request_id uuid)
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
    select 'profile'::text section, value from (select jsonb_build_object('pseudo',t.pseudo,'next_regular_pack_at',t.next_regular_pack_at,'next_decision_pack_at',t.next_decision_pack_at,'karas_balance',t.karas_balance,'avatar_url',case when t.avatar_url ~ '^https://[^/@?#]+/' then regexp_replace(t.avatar_url, '[?#].*$', '') else null end,'bio',t.bio,'featured_card_ids',t.featured_card_ids,'banner_card_id',t.banner_card_id,'is_public',t.is_public,'last_seen_at',t.last_seen_at,'presence_active',t.presence_active) value from public.user_profiles t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'progress'::text section, value from (select jsonb_build_object('regular_packs_opened', t.regular_packs_opened, 'decision_packs_completed', t.decision_packs_completed, 'auctions_won', t.auctions_won, 'trades_completed', t.trades_completed, 'ssr_evolved_to_lr', t.ssr_evolved_to_lr) value from public.user_achievement_stats t where t.user_id=p_user_id limit 100001) bounded
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
    select section,case when section in('account','profile','progress') then (jsonb_agg(value)->0)
      else jsonb_agg(value order by value::text) end value from rows group by section
  )
  select case when (select deleted from permitted) then '{"error":"ACCOUNT_DELETED"}'::jsonb
    when not (select reserved from permitted) then '{"error":"EXPORT_RESERVATION_REQUIRED"}'::jsonb
    when (select n>100000 or bytes>26214400 from size) then '{"error":"EXPORT_TOO_LARGE"}'::jsonb
    else jsonb_build_object('schema_version',1,'exported_at',statement_timestamp(),
      'catalogue_cards','[]'::jsonb,
      'account',null,
      'profile',null,
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

revoke all on function public.reserve_data_export(uuid,uuid),public.mark_data_export_sending(uuid,uuid),
  public.finish_data_export(uuid,uuid,boolean),public.build_data_export(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_data_export(uuid,uuid),public.mark_data_export_sending(uuid,uuid),
  public.finish_data_export(uuid,uuid,boolean),public.build_data_export(uuid,uuid) to service_role;

commit;
