begin;

alter table public.user_cards
  add column if not exists is_locked boolean not null default false;

create or replace function public.set_collection_card_locked(p_card_instance_id uuid, p_locked boolean)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare player_id uuid := auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if exists(select 1 from public.auctions where card_instance_id=p_card_instance_id and status='active') then
    raise exception 'CARD_FROZEN' using errcode = 'P0001';
  end if;
  update public.user_cards set is_locked=p_locked where id=p_card_instance_id and user_id=player_id;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode = 'P0001'; end if;
  return p_locked;
end;
$$;

create or replace function public.prevent_locked_card_transfer_or_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.is_locked and (tg_op='DELETE' or new.user_id is distinct from old.user_id) then
    raise exception 'CARD_LOCKED' using errcode = 'P0001';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists user_cards_prevent_locked_transfer_or_delete on public.user_cards;
create trigger user_cards_prevent_locked_transfer_or_delete
before update or delete on public.user_cards
for each row execute function public.prevent_locked_card_transfer_or_delete();

create or replace function public.prevent_locked_trade_offer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(
    select 1 from public.user_cards
    where is_locked and id=any(coalesce(new.offered_card_ids,'{}'::uuid[]) || coalesce(new.requested_card_ids,'{}'::uuid[]))
  ) then
    raise exception 'CARD_LOCKED' using errcode='P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trade_offers_prevent_locked_cards on public.trade_offers;
create trigger trade_offers_prevent_locked_cards
before insert or update of offered_card_ids,requested_card_ids on public.trade_offers
for each row execute function public.prevent_locked_trade_offer();

create or replace function public.create_auction(p_card_instance_id uuid,p_starting_price integer default 10,p_duration_minutes integer default 60)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); auction_id uuid; card_locked boolean;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  if p_starting_price<10 then raise exception 'INVALID_AUCTION_PRICE' using errcode='P0001'; end if;
  if p_duration_minutes not in (15,30,60,240,720,1440) then raise exception 'INVALID_AUCTION_DURATION' using errcode='P0001'; end if;
  select is_locked into card_locked from public.user_cards where id=p_card_instance_id and user_id=player_id for update;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  if card_locked then raise exception 'CARD_LOCKED' using errcode='P0001'; end if;
  update public.user_cards set custom_image_url=null where id=p_card_instance_id;
  insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,current_price)
    values(p_card_instance_id,player_id,p_starting_price,p_duration_minutes,clock_timestamp()+make_interval(mins=>p_duration_minutes),p_starting_price)
    returning id into auction_id;
  return auction_id;
exception when unique_violation then raise exception 'CARD_FROZEN' using errcode='P0001';
end;
$$;

create or replace function public.get_trade_context(p_friend_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); friend_name text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if public.friendship_state(player_id,p_friend_id)<>'accepted' then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  select pseudo into friend_name from public.user_profiles where user_id=p_friend_id;
  return jsonb_build_object('friend',jsonb_build_object('id',p_friend_id,'pseudo',friend_name),
    'balance',(select karas_balance from public.user_profiles where user_id=player_id),
    'ownCards',public.trade_card_json(array(select id from public.user_cards where user_id=player_id and not is_locked
      and not exists(select 1 from public.auctions where card_instance_id=user_cards.id and status='active'))),
    'friendCards',public.trade_card_json(array(select id from public.user_cards where user_id=p_friend_id and not is_locked
      and not exists(select 1 from public.auctions where card_instance_id=user_cards.id and status='active'))));
end;
$$;

create or replace function public.get_friend_collection(p_friend_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if public.friendship_state(player_id,p_friend_id)<>'accepted' then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'instanceId',uc.id,'id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
    'rarity',c.rarete_base,'image',coalesce(uc.custom_image_url,c.image_url),'catalogueImage',c.image_url,
    'customImageUrl',uc.custom_image_url,'obtainedAt',uc.date_obtention,'shiny',uc.is_shiny,
    'isEvolved',uc.is_evolved,'isFirstOwner',uc.is_first_owner,'locked',uc.is_locked,'folderId',null
  ) order by uc.date_obtention desc,uc.id),'[]'::jsonb)
  from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.user_id=p_friend_id);
end;
$$;

revoke all on function public.set_collection_card_locked(uuid,boolean) from public,anon;
grant execute on function public.set_collection_card_locked(uuid,boolean) to authenticated;

commit;
