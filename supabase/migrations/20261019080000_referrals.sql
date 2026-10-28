begin;

alter table public.user_profiles
  add column bonus_regular_packs integer not null default 0
  check (bonus_regular_packs >= 0);
revoke all (bonus_regular_packs) on public.user_profiles from anon, authenticated;

create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[a-f0-9]{12}$'),
  created_at timestamptz not null default clock_timestamp()
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.referral_codes (id) on delete cascade,
  referrer_id uuid not null references auth.users (id) on delete cascade,
  referred_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  verified_at timestamptz,
  rewarded_at timestamptz,
  reward_packs integer not null default 5 check (reward_packs = 5),
  check (referrer_id <> referred_id),
  check (rewarded_at is null or verified_at is not null)
);

create index referrals_referrer_created_idx
  on public.referrals (referrer_id, created_at desc);

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
revoke all on public.referral_codes, public.referrals
  from public, anon, authenticated;
grant all on public.referral_codes, public.referrals to service_role;

create function public.complete_referral_after_verification(
  p_referred_id uuid,
  p_verified_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral public.referrals;
begin
  if p_referred_id is null or p_verified_at is null then return; end if;

  select * into referral
    from public.referrals
    where referred_id = p_referred_id
    for update;
  if not found or referral.rewarded_at is not null then return; end if;

  update public.user_profiles
    set bonus_regular_packs = bonus_regular_packs + referral.reward_packs
    where user_id = referral.referrer_id;
  if not found then return; end if;

  update public.referrals
    set verified_at = p_verified_at,
        rewarded_at = clock_timestamp()
    where id = referral.id and rewarded_at is null;
end;
$$;
revoke all on function public.complete_referral_after_verification(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_pseudo text := btrim(new.raw_user_meta_data ->> 'pseudo');
  submitted_code text := lower(btrim(new.raw_user_meta_data ->> 'referral_code'));
begin
  if char_length(clean_pseudo) < 3 then
    raise exception 'PSEUDO_TOO_SHORT' using errcode = 'P0001';
  end if;
  if char_length(clean_pseudo) > 30 then
    raise exception 'PSEUDO_TOO_LONG' using errcode = 'P0001';
  end if;
  if clean_pseudo ~ '[/\\?#%<>[:cntrl:]]' then
    raise exception 'PSEUDO_INVALID_CHARACTERS' using errcode = 'P0001';
  end if;

  insert into public.user_profiles (user_id, pseudo)
  values (new.id, clean_pseudo);

  if submitted_code ~ '^[a-f0-9]{12}$' then
    insert into public.referrals (code_id, referrer_id, referred_id)
      select codes.id, codes.user_id, new.id
      from public.referral_codes codes
      where codes.code = submitted_code and codes.user_id <> new.id
      on conflict (referred_id) do nothing;
  end if;

  if new.email_confirmed_at is not null then
    perform public.complete_referral_after_verification(
      new.id,
      new.email_confirmed_at
    );
  end if;
  return new;
end;
$$;
revoke all on function public.handle_new_user_profile()
  from public, anon, authenticated;

create function public.on_referral_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.complete_referral_after_verification(
    new.id,
    new.email_confirmed_at
  );
  return new;
end;
$$;
revoke all on function public.on_referral_email_confirmed()
  from public, anon, authenticated;

create trigger on_auth_user_confirmed_referral
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.on_referral_email_confirmed();

create function public.create_referral_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  player uuid := auth.uid();
  existing_code text;
  candidate text;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_profiles where user_id = player
  ) then raise exception 'PROFILE_MISSING'; end if;
  if exists (
    select 1 from public.account_deletion_log where user_id = player
  ) then raise exception 'ACCOUNT_DELETING'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('referral-code:' || player::text, 0)
  );
  select code into existing_code
    from public.referral_codes where user_id = player;
  if existing_code is not null then return existing_code; end if;

  loop
    candidate := substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12);
    insert into public.referral_codes (user_id, code)
      values (player, candidate)
      on conflict (code) do nothing
      returning code into existing_code;
    if existing_code is not null then return existing_code; end if;
  end loop;
end;
$$;

create function public.get_referral_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  player uuid := auth.uid();
  referral_code text;
  verified_count integer;
  earned integer;
  bonus integer;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  select bonus_regular_packs into bonus
    from public.user_profiles where user_id = player;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  select code into referral_code
    from public.referral_codes where user_id = player;
  select count(*)::integer,
      coalesce(sum(reward_packs) filter (where rewarded_at is not null), 0)::integer
    into verified_count, earned
    from public.referrals
    where referrer_id = player and rewarded_at is not null;
  return jsonb_build_object(
    'code', referral_code,
    'verifiedReferrals', verified_count,
    'packsEarned', earned,
    'bonusPacks', bonus
  );
end;
$$;

revoke all on function public.create_referral_code(), public.get_referral_status()
  from public, anon;
grant execute on function public.create_referral_code(), public.get_referral_status()
  to authenticated;

create or replace function public.get_regular_pack_status()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player uuid:=auth.uid(); deadline timestamptz; stamp timestamptz;
  step integer; reserve_available integer; bonus integer;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player);
  select next_regular_pack_at,regular_pack_interval_seconds,bonus_regular_packs
    into deadline,step,bonus
    from public.user_profiles where user_id=player;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  stamp:=clock_timestamp();
  reserve_available:=least(5,greatest(0,1+floor(extract(epoch from(stamp-deadline))/step)))::integer;
  return jsonb_build_object(
    'available',reserve_available+bonus,
    'maximum',5,
    'reserve',reserve_available,
    'bonus',bonus,
    'nextPackAt',case when reserve_available=5 then null else extract(epoch from(deadline+make_interval(secs=>reserve_available*step)))*1000 end,
    'serverNow',extract(epoch from stamp)*1000,
    'refillSeconds',step
  );
end;
$$;

create or replace function public.open_regular_pack()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  player_id uuid:=auth.uid(); deadline timestamptz; server_now timestamptz;
  step integer; bonus integer;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[]:=array['C','R','SR','SSR','LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; copy_ids uuid[]:='{}'; card_ids uuid[]:='{}'; shinies boolean[]:='{}';
  result jsonb:='[]'::jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.billing_sync_pack_timing(player_id);
  select next_regular_pack_at,regular_pack_interval_seconds,bonus_regular_packs
    into deadline,step,bonus
    from public.user_profiles where user_id=player_id for update;
  if not found then raise exception 'PROFILE_MISSING'; end if;
  server_now:=clock_timestamp();
  if bonus=0 and deadline>server_now then raise exception 'PACK_NOT_READY'; end if;
  select array[count(*) filter(where rarete_base='C'),count(*) filter(where rarete_base='R'),
    count(*) filter(where rarete_base='SR'),count(*) filter(where rarete_base='SSR'),
    count(*) filter(where rarete_base='LR')] into pool_sizes from public.cards;
  if 0=any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE'; end if;
  for position in 1..5 loop
    roll:=random();
    rarity_index:=case when roll<.724 then 1 when roll<.924 then 2 when roll<.994 then 3 when roll<.999 then 4 else 5 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny:=selected_card.rarete_base='LR' and random()<.001;
    copy_id:=gen_random_uuid();
    copy_ids:=array_append(copy_ids,copy_id); card_ids:=array_append(card_ids,selected_card.id); shinies:=array_append(shinies,shiny);
    result:=result||jsonb_build_array(jsonb_build_object(
      'id',selected_card.id,'name',selected_card.nom,'category',selected_card.categorie,
      'liveFranchise',true,'anime',selected_card.franchise,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
      'catalogueImage',selected_card.image_url,'customImageUrl',null,
      'instanceId',copy_id,'obtainedAt',server_now,'shiny',shiny,'isEvolved',false,
      'isFirstOwner',selected_card.rarete_base='LR','folderId',null));
  end loop;
  insert into public.user_cards(id,user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    select drawn.id,player_id,drawn.card_id,server_now,c.rarete_base,drawn.shiny,false,c.rarete_base='LR'
    from unnest(copy_ids,card_ids,shinies) as drawn(id,card_id,shiny) join public.cards c on c.id=drawn.card_id;
  update public.user_profiles set
    bonus_regular_packs=case when bonus>0 then bonus-1 else 0 end,
    next_regular_pack_at=case when bonus>0 then deadline
      else greatest(deadline,server_now-make_interval(secs=>4*step))+make_interval(secs=>step) end
    where user_id=player_id;
  perform public.ensure_achievement_stats(player_id);
  update public.user_achievement_stats set regular_packs_opened=regular_packs_opened+1 where user_id=player_id;
  perform public.complete_achievements(player_id,array['regular_packs_opened']);
  return result;
end;
$$;

revoke all on function public.get_regular_pack_status(), public.open_regular_pack()
  from public, anon;
grant execute on function public.get_regular_pack_status(), public.open_regular_pack()
  to authenticated;

-- Keep the referral balance in the account's single-statement data export.
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
    select 'private_messages'::text section,value from (select jsonb_build_object('id',t.id,'text',t.body,'gif_url',t.gif_url,'created_at',t.created_at,'recipient',jsonb_build_object('pseudo',(select pseudo from public.user_profiles where user_id=t.recipient_id))) value from public.private_messages t where t.sender_id=p_user_id limit 100001) bounded
    union all
    select 'wall_posts'::text section,value from (select jsonb_build_object('id',t.id,'text',t.body,'gif_url',t.gif_url,'has_image',t.media_path is not null,'created_at',t.created_at) value from public.profile_wall_posts t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'wall_files'::text section,value from (select jsonb_build_object('type',to_jsonb(t)->'metadata'->'mimetype','size',to_jsonb(t)->'metadata'->'size') value from storage.objects t where t.bucket_id='profile-wall-media' and split_part(t.name,'/',1)=p_user_id::text limit 100001) bounded
    union all
    select 'profile'::text section, value from (select jsonb_build_object('pseudo',t.pseudo,'next_regular_pack_at',t.next_regular_pack_at,'regular_pack_interval_seconds',t.regular_pack_interval_seconds,'bonus_regular_packs',t.bonus_regular_packs,'decision_pack_interval_seconds',t.decision_pack_interval_seconds,'next_decision_pack_at',t.next_decision_pack_at,'karas_balance',t.karas_balance,'avatar_url',case when t.avatar_url ~ '^https://[^/@?#]+/' then regexp_replace(t.avatar_url, '[?#].*$', '') else null end,'bio',t.bio,'featured_card_ids',t.featured_card_ids,'banner_card_id',t.banner_card_id,'is_public',t.is_public,'last_seen_at',t.last_seen_at,'presence_active',t.presence_active,'interests',t.interests,'profile_widgets',t.profile_widgets,'banner_frame',t.banner_frame,'banner_frame_source',case when t.banner_frame_source ~ '^https://[^/@?#]+/' then regexp_replace(t.banner_frame_source,'[?#].*$','') else t.banner_frame_source end,'banner_url',case when t.banner_url ~ '^https://[^/@?#]+/' then regexp_replace(t.banner_url,'[?#].*$','') else null end) value from public.user_profiles t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'profile_customizations'::text section,value from (select jsonb_build_object('style',t.style,'updated_at',t.updated_at) value from public.profile_customizations t where t.user_id=p_user_id limit 100001) bounded
    union all
    select 'profile_media'::text section,value from (select jsonb_build_object('purpose',t.purpose,'mime_type',t.mime_type,'animated',t.animated,'public_url',regexp_replace(t.public_url,'[?#].*$',''),'created_at',t.created_at) value from public.profile_media_assets t where t.user_id=p_user_id limit 100001) bounded
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
      'profile_customizations','[]'::jsonb,'profile_media','[]'::jsonb,
      'private_messages','[]'::jsonb,
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

notify pgrst, 'reload schema';
commit;
