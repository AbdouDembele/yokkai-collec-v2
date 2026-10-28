begin;

alter table public.user_profiles add column if not exists is_public boolean not null default true;

create or replace function public.can_view_collection(p_viewer uuid,p_owner uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_viewer=p_owner or coalesce((select is_public from public.user_profiles where user_id=p_owner),false)
    or public.friendship_state(p_viewer,p_owner)='accepted'
$$;
revoke all on function public.can_view_collection(uuid,uuid) from public,anon,authenticated;

create or replace function public.get_profile_privacy()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); result boolean;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select is_public into result from public.user_profiles where user_id=player_id;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;

create or replace function public.set_profile_privacy(p_is_public boolean)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  update public.user_profiles set is_public=coalesce(p_is_public,true) where user_id=player_id;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return coalesce(p_is_public,true);
end; $$;

create or replace function public.get_profile(p_identifier text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); target public.user_profiles%rowtype; result jsonb; allowed boolean;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_identifier is null or btrim(p_identifier)='' then
    select * into target from public.user_profiles where user_id=viewer;
  else
    select * into target from public.user_profiles where lower(pseudo)=lower(btrim(p_identifier))
      or user_id=case when p_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_identifier::uuid else null end limit 1;
  end if;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  allowed:=public.can_view_collection(viewer,target.user_id);
  select jsonb_build_object(
    'id',target.user_id,'pseudo',target.pseudo,'avatarUrl',target.avatar_url,'bio',target.bio,
    'isPublic',target.is_public,'canViewCollection',allowed,
    'bannerCard',(select jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url) from public.cards c where c.id=target.banner_card_id),
    'friendshipStatus',case when target.user_id=viewer then 'self' else public.friendship_state(viewer,target.user_id) end,
    'featuredCards',case when allowed then coalesce((select jsonb_agg(public.profile_card_json(c,uc) order by pos)
      from unnest(target.featured_card_ids) with ordinality picked(instance_id,pos)
      join public.user_cards uc on uc.id=picked.instance_id and uc.user_id=target.user_id
      join public.cards c on c.id=uc.card_id),'[]'::jsonb) else '[]'::jsonb end,
    'friends',coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url) order by lower(p.pseudo))
      from public.friendships f join public.user_profiles p on p.user_id=case when f.user_id=target.user_id then f.friend_id else f.user_id end
      where f.status='accepted' and (f.user_id=target.user_id or f.friend_id=target.user_id)),'[]'::jsonb),
    'cardCount',case when allowed then (select count(*) from public.user_cards where user_id=target.user_id) else null end,
    'distinctCardCount',case when allowed then (select count(distinct card_id) from public.user_cards where user_id=target.user_id) else null end
  ) into result;
  return result;
end; $$;

create or replace function public.get_friend_collection(p_friend_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not public.can_view_collection(player_id,p_friend_id) then raise exception 'PROFILE_PRIVATE' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'instanceId',uc.id,'id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
    'rarity',c.rarete_base,'image',coalesce(uc.custom_image_url,c.image_url),'catalogueImage',c.image_url,
    'customImageUrl',uc.custom_image_url,'obtainedAt',uc.date_obtention,'shiny',uc.is_shiny,
    'isEvolved',uc.is_evolved,'isFirstOwner',uc.is_first_owner,'locked',uc.is_locked,'folderId',null
  ) order by uc.date_obtention desc,uc.id),'[]'::jsonb)
  from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.user_id=p_friend_id);
end; $$;

create or replace function public.get_card_discovery(p_card_id uuid,p_owner_offset integer default 0,p_owner_limit integer default 12)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); result jsonb; safe_limit integer:=least(greatest(coalesce(p_owner_limit,12),1),30); safe_offset integer:=greatest(coalesce(p_owner_offset,0),0);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select jsonb_build_object(
    'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url),
    'marketValue',(select avg(a.current_price)::numeric(12,2) from public.auctions a join public.user_cards sold_uc on sold_uc.id=a.card_instance_id where a.status='sold' and sold_uc.card_id=c.id),
    'activeAuctionId',(select a.id from public.auctions a join public.user_cards auc_uc on auc_uc.id=a.card_instance_id where a.status='active' and auc_uc.card_id=c.id order by a.ends_at limit 1),
    'wishlisted',exists(select 1 from public.wishlists w where w.user_id=player_id and w.card_id=c.id),
    'ownerCount',(select count(distinct uc.user_id) from public.user_cards uc where uc.card_id=c.id and public.can_view_collection(player_id,uc.user_id)),
    'owners',coalesce((select jsonb_agg(jsonb_build_object('id',o.user_id,'pseudo',o.pseudo,'copies',o.copies,'isFriend',o.is_friend) order by o.is_friend desc,o.pseudo,o.user_id)
      from (select uc.user_id,p.pseudo,count(*) copies,public.friendship_state(player_id,uc.user_id)='accepted' is_friend
        from public.user_cards uc join public.user_profiles p on p.user_id=uc.user_id
        where uc.card_id=c.id and public.can_view_collection(player_id,uc.user_id)
        group by uc.user_id,p.pseudo order by is_friend desc,p.pseudo,uc.user_id offset safe_offset limit safe_limit) o),'[]'::jsonb)
  ) into result from public.cards c where c.id=p_card_id;
  if result is null then raise exception 'CARD_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;

revoke all on function public.get_profile_privacy(),public.set_profile_privacy(boolean) from public,anon,authenticated;
grant execute on function public.get_profile_privacy(),public.set_profile_privacy(boolean) to authenticated;
revoke all on function public.get_profile(text) from public,anon,authenticated;
grant execute on function public.get_profile(text) to authenticated;
revoke all on function public.get_friend_collection(uuid),public.get_card_discovery(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.get_friend_collection(uuid),public.get_card_discovery(uuid,integer,integer) to authenticated;

commit;
