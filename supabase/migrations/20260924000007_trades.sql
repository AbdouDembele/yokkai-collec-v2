begin;

create table public.trade_offers (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  offered_card_ids uuid[] not null default '{}',
  offered_karas integer not null default 0 check (offered_karas>=0),
  requested_card_ids uuid[] not null default '{}',
  requested_karas integer not null default 0 check (requested_karas>=0),
  status text not null default 'pending' check (status in ('pending','accepted','declined','countered')),
  parent_offer_id uuid references public.trade_offers(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (from_user<>to_user),
  check (cardinality(offered_card_ids)>0 or offered_karas>0 or cardinality(requested_card_ids)>0 or requested_karas>0)
);
create index trade_offers_users_idx on public.trade_offers(from_user,to_user,created_at desc);
alter table public.trade_offers enable row level security;
revoke all on table public.trade_offers from public,anon,authenticated;
grant all on table public.trade_offers to service_role;

create function public.trade_card_json(p_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('instanceId',uc.id,'id',c.id,'name',c.nom,'category',c.categorie,
    'rarity',c.rarete_base,'image',c.image_url,'shiny',uc.is_shiny,'isEvolved',uc.is_evolved,'isFirstOwner',uc.is_first_owner,
    'obtainedAt',uc.date_obtention,'folderId',uc.folder_id) order by array_position(p_ids,uc.id)),'[]'::jsonb)
  from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.id=any(p_ids)
$$;
revoke all on function public.trade_card_json(uuid[]) from public,anon,authenticated;

create function public.get_trade_context(p_friend_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); friend_name text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if public.friendship_state(player_id,p_friend_id)<>'accepted' then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  select pseudo into friend_name from public.user_profiles where user_id=p_friend_id;
  return jsonb_build_object('friend',jsonb_build_object('id',p_friend_id,'pseudo',friend_name),
    'balance',(select karas_balance from public.user_profiles where user_id=player_id),
    'ownCards',public.trade_card_json(array(select id from public.user_cards where user_id=player_id
      and not exists(select 1 from public.auctions where card_instance_id=user_cards.id and status='active'))),
    'friendCards',public.trade_card_json(array(select id from public.user_cards where user_id=p_friend_id
      and not exists(select 1 from public.auctions where card_instance_id=user_cards.id and status='active'))));
end; $$;

create function public.list_trade_offers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'fromUser',o.from_user,'toUser',o.to_user,
    'incoming',o.to_user=player_id,
    'fromPseudo',fp.pseudo,'toPseudo',tp.pseudo,'offeredCards',public.trade_card_json(o.offered_card_ids),
    'offeredKaras',o.offered_karas,'requestedCards',public.trade_card_json(o.requested_card_ids),
    'requestedKaras',o.requested_karas,'status',o.status,'parentOfferId',o.parent_offer_id,'createdAt',o.created_at)
    order by o.created_at desc),'[]'::jsonb) from public.trade_offers o
    join public.user_profiles fp on fp.user_id=o.from_user join public.user_profiles tp on tp.user_id=o.to_user
    where o.from_user=player_id or o.to_user=player_id);
end; $$;

create function public.create_trade_offer(p_to_user uuid,p_offered_card_ids uuid[] default '{}',p_offered_karas integer default 0,
  p_requested_card_ids uuid[] default '{}',p_requested_karas integer default 0,p_parent_offer_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); offer_id uuid; parent public.trade_offers%rowtype;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  p_offered_card_ids:=coalesce(p_offered_card_ids,'{}'); p_requested_card_ids:=coalesce(p_requested_card_ids,'{}');
  if p_offered_karas<0 or p_requested_karas<0 then raise exception 'INVALID_TRADE_KARAS' using errcode='P0001'; end if;
  if cardinality(p_offered_card_ids)=0 and p_offered_karas=0 and cardinality(p_requested_card_ids)=0 and p_requested_karas=0 then raise exception 'EMPTY_TRADE' using errcode='P0001'; end if;
  if public.friendship_state(player_id,p_to_user)<>'accepted' then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  if cardinality(p_offered_card_ids)<>(select count(distinct id) from unnest(p_offered_card_ids) id)
    or cardinality(p_requested_card_ids)<>(select count(distinct id) from unnest(p_requested_card_ids) id) then raise exception 'DUPLICATE_TRADE_CARD' using errcode='P0001'; end if;
  if (select count(*) from public.user_cards where user_id=player_id and id=any(p_offered_card_ids))<>cardinality(p_offered_card_ids)
    or (select count(*) from public.user_cards where user_id=p_to_user and id=any(p_requested_card_ids))<>cardinality(p_requested_card_ids) then raise exception 'TRADE_CARD_UNAVAILABLE' using errcode='P0001'; end if;
  if exists(select 1 from public.auctions where status='active' and card_instance_id=any(p_offered_card_ids||p_requested_card_ids)) then raise exception 'TRADE_CARD_FROZEN' using errcode='P0001'; end if;
  if p_parent_offer_id is not null then
    select * into parent from public.trade_offers where id=p_parent_offer_id for update;
    if not found or parent.status<>'pending' or parent.to_user<>player_id or parent.from_user<>p_to_user then raise exception 'TRADE_NOT_COUNTERABLE' using errcode='P0001'; end if;
    update public.trade_offers set status='countered',updated_at=clock_timestamp() where id=parent.id;
  end if;
  insert into public.trade_offers(from_user,to_user,offered_card_ids,offered_karas,requested_card_ids,requested_karas,parent_offer_id)
    values(player_id,p_to_user,p_offered_card_ids,p_offered_karas,p_requested_card_ids,p_requested_karas,p_parent_offer_id) returning id into offer_id;
  return offer_id;
end; $$;

create function public.respond_trade_offer(p_offer_id uuid,p_action text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); offer public.trade_offers%rowtype;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_action not in ('accept','decline') then raise exception 'INVALID_TRADE_ACTION' using errcode='P0001'; end if;
  select * into offer from public.trade_offers where id=p_offer_id for update;
  if not found or offer.status<>'pending' or offer.to_user<>player_id then raise exception 'TRADE_NOT_PENDING' using errcode='P0001'; end if;
  if p_action='decline' then update public.trade_offers set status='declined',updated_at=clock_timestamp() where id=offer.id; return false; end if;
  if public.friendship_state(offer.from_user,offer.to_user)<>'accepted' then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  perform 1 from public.user_profiles where user_id in (offer.from_user,offer.to_user) order by user_id for update;
  perform 1 from public.user_cards where id=any(offer.offered_card_ids||offer.requested_card_ids) order by id for update;
  if (select count(*) from public.user_cards where user_id=offer.from_user and id=any(offer.offered_card_ids))<>cardinality(offer.offered_card_ids)
    or (select count(*) from public.user_cards where user_id=offer.to_user and id=any(offer.requested_card_ids))<>cardinality(offer.requested_card_ids) then raise exception 'TRADE_CARD_UNAVAILABLE' using errcode='P0001'; end if;
  if exists(select 1 from public.auctions where status='active' and card_instance_id=any(offer.offered_card_ids||offer.requested_card_ids)) then raise exception 'TRADE_CARD_FROZEN' using errcode='P0001'; end if;
  if (select karas_balance from public.user_profiles where user_id=offer.from_user)<offer.offered_karas
    or (select karas_balance from public.user_profiles where user_id=offer.to_user)<offer.requested_karas then raise exception 'TRADE_INSUFFICIENT_KARAS' using errcode='P0001'; end if;
  update public.user_profiles set karas_balance=karas_balance-offer.offered_karas+offer.requested_karas where user_id=offer.from_user;
  update public.user_profiles set karas_balance=karas_balance-offer.requested_karas+offer.offered_karas where user_id=offer.to_user;
  update public.user_cards set user_id=offer.to_user,folder_id=null,is_first_owner=false,date_obtention=clock_timestamp() where id=any(offer.offered_card_ids);
  update public.user_cards set user_id=offer.from_user,folder_id=null,is_first_owner=false,date_obtention=clock_timestamp() where id=any(offer.requested_card_ids);
  delete from public.wishlist w where (w.user_id=offer.to_user and w.card_id in (select card_id from public.user_cards where id=any(offer.offered_card_ids)))
    or (w.user_id=offer.from_user and w.card_id in (select card_id from public.user_cards where id=any(offer.requested_card_ids)));
  update public.trade_offers set status='accepted',updated_at=clock_timestamp() where id=offer.id;
  return true;
end; $$;

revoke all on function public.get_trade_context(uuid),public.list_trade_offers(),
  public.create_trade_offer(uuid,uuid[],integer,uuid[],integer,uuid),public.respond_trade_offer(uuid,text) from public,anon,authenticated;
grant execute on function public.get_trade_context(uuid),public.list_trade_offers(),
  public.create_trade_offer(uuid,uuid[],integer,uuid[],integer,uuid),public.respond_trade_offer(uuid,text) to authenticated;

commit;
