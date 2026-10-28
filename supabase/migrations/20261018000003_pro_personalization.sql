begin;

-- Server-validated immutable assets let Basic members keep uploading static
-- avatars without allowing a GIF renamed to .jpg to bypass the paid gate.
create table public.profile_media_assets (
  path text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check(purpose in ('avatar','banner','background','card-back')),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','image/gif')),
  animated boolean not null,
  public_url text not null unique check(char_length(public_url)<=2048 and public_url ~ '^https?://[^[:space:]]+$'),
  created_at timestamptz not null default clock_timestamp(),
  check(path ~ ('^'||user_id::text||'/[a-z-]+[.](jpg|png|webp|gif)$')
    or path ~ ('^'||user_id::text||'/[a-z-]+[0-9a-f-]+[.](jpg|png|webp|gif)$'))
);
create index profile_media_assets_owner_created on public.profile_media_assets(user_id,created_at);
alter table public.profile_media_assets enable row level security;
revoke all on public.profile_media_assets from public,anon,authenticated;
grant select,insert,delete on public.profile_media_assets to service_role;

create function public.guard_profile_media_reservation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.account_deletion_log where user_id=new.user_id) then raise exception 'ACCOUNT_DELETED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||new.user_id::text,0));
  if exists(select 1 from public.account_deletion_log where user_id=new.user_id) then raise exception 'ACCOUNT_DELETED'; end if;
  if (new.purpose<>'avatar' or new.animated) and not public.billing_has_game_pro(new.user_id) then raise exception 'PRO_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profile-media:'||new.user_id::text,0));
  if (select count(*) from public.profile_media_assets where user_id=new.user_id and created_at>clock_timestamp()-interval '10 minutes')>=10
    then raise exception 'PROFILE_MEDIA_RATE_LIMITED'; end if;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
revoke all on function public.guard_profile_media_reservation() from public,anon,authenticated;
create trigger guard_profile_media_reservation before insert on public.profile_media_assets
  for each row execute function public.guard_profile_media_reservation();

create table public.profile_customizations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  style jsonb not null default '{}'::jsonb check(jsonb_typeof(style)='object' and octet_length(style::text)<=4096),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.profile_customizations enable row level security;
revoke all on public.profile_customizations from public,anon,authenticated;
grant select,insert,update,delete on public.profile_customizations to service_role;

create function public.guard_pro_profile_style() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; media_url text; media_path text;
begin
  if exists(select 1 from public.account_deletion_log where user_id=new.user_id) then raise exception 'ACCOUNT_DELETED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||new.user_id::text,0));
  if exists(select 1 from public.account_deletion_log where user_id=new.user_id) then raise exception 'ACCOUNT_DELETED'; end if;
  if new.style='{}'::jsonb then new.updated_at:=clock_timestamp(); return new; end if;
  if not public.billing_has_game_pro(new.user_id) then raise exception 'PRO_REQUIRED'; end if;
  if tg_op='UPDATE' and old.updated_at>clock_timestamp()-interval '2 seconds' and new.style is distinct from old.style
    then raise exception 'PROFILE_STYLE_RATE_LIMITED'; end if;
  if jsonb_typeof(new.style)<>'object' or octet_length(new.style::text)>4096 then raise exception 'PROFILE_STYLE_INVALID'; end if;
  if exists(select 1 from jsonb_object_keys(new.style) key where key not in
      ('font','effect','color','secondary','badges','theme','avatarFrame','showcaseEffect','backgroundUrl','cardBackUrl'))
    then raise exception 'PROFILE_STYLE_INVALID'; end if;
  if new.style ? 'font' and (jsonb_typeof(new.style->'font')<>'string' or (new.style->>'font') not in ('modern','classic','rounded','mono','bold','editorial','script','display')) then raise exception 'PROFILE_STYLE_INVALID'; end if;
  if new.style ? 'effect' and (jsonb_typeof(new.style->'effect')<>'string' or (new.style->>'effect') not in ('solid','gradient','neon','outline','pop','shimmer','prism')) then raise exception 'PROFILE_STYLE_INVALID'; end if;
  foreach k in array array['color','secondary'] loop
    if new.style ? k and (jsonb_typeof(new.style->k)<>'string' or (new.style->>k)!~ '^#[A-Fa-f0-9]{6}$') then raise exception 'PROFILE_STYLE_INVALID'; end if;
  end loop;
  if new.style ? 'badges' then
    if jsonb_typeof(new.style->'badges')<>'array' then raise exception 'PROFILE_STYLE_INVALID'; end if;
    if jsonb_array_length(new.style->'badges')>3
      or exists(select 1 from jsonb_array_elements_text(new.style->'badges') badge where badge not in ('comet','bloom','crystal','orbit','flame','moon'))
      or jsonb_array_length(new.style->'badges')<>(select count(distinct badge) from jsonb_array_elements_text(new.style->'badges') badge)
      then raise exception 'PROFILE_STYLE_INVALID'; end if;
  end if;
  if new.style ? 'theme' and (jsonb_typeof(new.style->'theme')<>'string' or (new.style->>'theme') not in ('default','amethyst','midnight','rose','ocean')) then raise exception 'PROFILE_STYLE_INVALID'; end if;
  if new.style ? 'avatarFrame' and (jsonb_typeof(new.style->'avatarFrame')<>'string' or (new.style->>'avatarFrame') not in ('none','orbit','crystal','bloom','flame')) then raise exception 'PROFILE_STYLE_INVALID'; end if;
  if new.style ? 'showcaseEffect' and (jsonb_typeof(new.style->'showcaseEffect')<>'string' or (new.style->>'showcaseEffect') not in ('none','glow','sparkle','prism')) then raise exception 'PROFILE_STYLE_INVALID'; end if;
  foreach k in array array['backgroundUrl','cardBackUrl'] loop
    media_url:=nullif(new.style->>k,'');
    if media_url is not null then
      if not exists(select 1 from public.profile_media_assets where public_url=media_url and user_id=new.user_id
        and purpose=case when k='backgroundUrl' then 'background' else 'card-back' end) then raise exception 'PROFILE_STYLE_INVALID'; end if;
    end if;
  end loop;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;
revoke all on function public.guard_pro_profile_style() from public,anon,authenticated;
create trigger guard_pro_profile_style before insert or update on public.profile_customizations
  for each row execute function public.guard_pro_profile_style();

create function public.billing_profile_cosmetics(p_user uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object('active',paid,'style',case when paid then
    coalesce((select style from public.profile_customizations where user_id=p_user),'{}'::jsonb) else '{}'::jsonb end)
  from (select public.billing_has_game_pro(p_user) paid) membership;
$$;
revoke all on function public.billing_profile_cosmetics(uuid) from public,anon,authenticated;
grant execute on function public.billing_profile_cosmetics(uuid) to service_role;

-- Keep the existing privacy/block/ownership projections intact; append only
-- paid, bounded cosmetics after their access checks, including chat and wall.
alter function public.get_profile(text) rename to billing_base_get_profile;
revoke all on function public.billing_base_get_profile(text) from public,anon,authenticated;
create function public.get_profile(p_identifier text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb; cosmetics jsonb;
begin
  result:=public.billing_base_get_profile(p_identifier);
  cosmetics:=public.billing_profile_cosmetics((result->>'id')::uuid);
  return result||jsonb_build_object('isPro',(cosmetics->>'active')::boolean,'profileStyle',cosmetics);
end;
$$;
revoke all on function public.get_profile(text) from public,anon,authenticated;
grant execute on function public.get_profile(text) to authenticated;

alter function public.get_auction_chat(uuid) rename to billing_base_get_auction_chat;
revoke all on function public.billing_base_get_auction_chat(uuid) from public,anon,authenticated;
create function public.get_auction_chat(p_auction_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb; k text;
begin
  result:=public.billing_base_get_auction_chat(p_auction_id);
  foreach k in array array['messages','participants'] loop
    result:=jsonb_set(result,array[k],coalesce((select jsonb_agg(item||jsonb_build_object('profileStyle',public.billing_profile_cosmetics((item->>'userId')::uuid)) order by pos)
      from jsonb_array_elements(result->k) with ordinality entries(item,pos)),'[]'::jsonb));
  end loop;
  return result;
end;
$$;
revoke all on function public.get_auction_chat(uuid) from public,anon,authenticated;
grant execute on function public.get_auction_chat(uuid) to authenticated;

alter function public.get_profile_wall(uuid,timestamptz,uuid,integer) rename to billing_base_get_profile_wall;
revoke all on function public.billing_base_get_profile_wall(uuid,timestamptz,uuid,integer) from public,anon,authenticated;
create function public.get_profile_wall(p_owner_id uuid,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
  result:=public.billing_base_get_profile_wall(p_owner_id,p_before,p_before_id,p_limit);
  return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item||jsonb_build_object('profileStyle',public.billing_profile_cosmetics(p_owner_id)) order by pos)
    from jsonb_array_elements(result->'items') with ordinality entries(item,pos)),'[]'::jsonb));
end;
$$;
revoke all on function public.get_profile_wall(uuid,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.get_profile_wall(uuid,timestamptz,uuid,integer) to authenticated;

create function public.guard_pro_profile_appearance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare avatar_path text;
begin
  if new.banner_url is not null and new.banner_url is distinct from old.banner_url
    and not public.billing_has_game_pro(new.user_id) then raise exception 'PRO_REQUIRED'; end if;
  if new.avatar_url is not null and new.avatar_url is distinct from old.avatar_url then
    if new.avatar_url !~ ('^https://api[.]yokkai-collec[.]com/storage/v1/object/public/avatars/'||new.user_id::text||'/[A-Za-z0-9_/-]+[.](jpg|jpeg|png|webp|gif)([?]v=[0-9]+)?$')
      and not exists(select 1 from public.profile_media_assets where public_url=new.avatar_url and user_id=new.user_id and purpose='avatar')
      then raise exception 'AVATAR_URL_INVALID'; end if;
    if not public.billing_has_game_pro(new.user_id) then
      if not exists(select 1 from public.profile_media_assets where public_url=new.avatar_url and user_id=new.user_id and purpose='avatar' and not animated)
        then raise exception 'PRO_REQUIRED'; end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_pro_profile_appearance() from public,anon,authenticated;
create trigger guard_pro_profile_appearance before update of avatar_url,banner_url on public.user_profiles
  for each row execute function public.guard_pro_profile_appearance();

-- Basic writes go through the byte-validating server endpoint. Pro clients may
-- retain the legacy upload UI, but cannot replace immutable validated assets.
create policy avatars_require_pro_insert on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'avatars' or (
    (public.get_profile(null)->>'isPro')::boolean
    and name !~ '/(avatar|background|card-back)-[0-9a-f-]+[.]'));
create policy avatars_require_pro_update on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'avatars' or ((public.get_profile(null)->>'isPro')::boolean and name !~ '/(avatar|background|card-back)-[0-9a-f-]+[.]'))
  with check(bucket_id<>'avatars' or ((public.get_profile(null)->>'isPro')::boolean and name !~ '/(avatar|background|card-back)-[0-9a-f-]+[.]'));

alter table public.user_cards drop constraint if exists user_cards_custom_image_url_check;
alter table public.user_cards add constraint user_cards_custom_image_url_check check(custom_image_url is null or
  (char_length(custom_image_url)<=2048 and custom_image_url ~* '^https://((i[.])?imgur[.]com|i[.]pinimg[.]com)/[^[:space:]]+$'));
create or replace function public.set_card_custom_image(p_card_instance_id uuid,p_image_url text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player uuid:=auth.uid(); image text:=nullif(btrim(p_image_url),''); previous text; result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if image is not null and (char_length(image)>2048 or image !~* '^https://((i[.])?imgur[.]com|i[.]pinimg[.]com)/[^[:space:]]+$') then raise exception 'INVALID_IMGUR_URL'; end if;
  select custom_image_url into previous from public.user_cards where id=p_card_instance_id and user_id=player for update;
  if not found then raise exception 'CARD_NOT_OWNED'; end if;
  if image is not null and image is distinct from previous and not public.billing_has_game_pro(player) then raise exception 'PRO_REQUIRED'; end if;
  update public.user_cards set custom_image_url=image where id=p_card_instance_id;
  select public.profile_card_json(c,uc) into result from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.id=p_card_instance_id;
  return result;
end;
$$;
revoke all on function public.set_card_custom_image(uuid,text) from public,anon,authenticated;
grant execute on function public.set_card_custom_image(uuid,text) to authenticated;

-- Keep an unchanged imported banner through the two-phase appearance save;
-- Basic members may edit their biography or remove old paid cosmetics.
create or replace function public.update_profile_appearance(
  p_bio text,p_avatar_url text,p_featured_card_ids uuid[],p_banner_card_id uuid,p_banner_url text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare player uuid:=auth.uid(); banner text:=nullif(btrim(p_banner_url),''); result jsonb; previous_source text; previous_frame jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||player::text,0));
  select banner_frame_source,banner_frame into previous_source,previous_frame from public.user_profiles where user_id=player for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if exists(select 1 from public.account_deletion_log where user_id=player) then raise exception 'ACCOUNT_DELETED'; end if;
  if banner is not null and (char_length(p_banner_url)>2048 or (
    banner !~ ('^https://api[.]yokkai-collec[.]com/storage/v1/object/public/avatars/'||player::text||'/banner[.](jpg|jpeg|png|webp|gif)([?]v=[0-9]+)?$')
    and not exists(select 1 from public.profile_media_assets where user_id=player and purpose='banner' and public_url=banner))) then raise exception 'BANNER_URL_INVALID'; end if;
  if banner is not null and p_banner_card_id is not null then raise exception 'BANNER_URL_INVALID'; end if;
  result:=public.billing_update_profile_fields(p_bio,p_avatar_url,p_featured_card_ids,p_banner_card_id,true);
  update public.user_profiles set banner_url=banner,
    banner_frame=case when previous_source=coalesce(banner,p_banner_card_id::text) then previous_frame else null end,
    banner_frame_source=case when previous_source=coalesce(banner,p_banner_card_id::text) then previous_source else null end
    where user_id=player;
  return result||jsonb_build_object('bannerUrl',banner);
end;
$$;
revoke all on function public.update_profile_appearance(text,text,uuid[],uuid,text) from public,anon,authenticated;
grant execute on function public.update_profile_appearance(text,text,uuid[],uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
