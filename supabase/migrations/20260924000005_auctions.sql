begin;

create table public.auctions (
  id uuid primary key default gen_random_uuid(),
  card_instance_id uuid references public.user_cards(id) on delete set null,
  seller_id uuid not null references auth.users(id) on delete restrict,
  starting_price integer not null default 10 check (starting_price >= 10),
  duration_minutes integer not null check (duration_minutes in (15,30,60,240,720,1440)),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','sold','expired')),
  current_price integer not null check (current_price >= 10),
  buyer_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index auctions_one_active_card on public.auctions(card_instance_id) where status='active';
create index auctions_active_ends_idx on public.auctions(status,ends_at);

create table public.bids (
  id uuid primary key default gen_random_uuid(), auction_id uuid not null references public.auctions(id) on delete cascade,
  bidder_id uuid not null references auth.users(id) on delete restrict,
  amount integer not null check (amount >= 10), created_at timestamptz not null default now()
);
create index bids_auction_created_idx on public.bids(auction_id,created_at desc);

create table public.auction_watchers (
  user_id uuid not null references auth.users(id) on delete cascade,
  auction_id uuid not null references public.auctions(id) on delete cascade,
  primary key(user_id,auction_id)
);

alter table public.auctions enable row level security;
alter table public.bids enable row level security;
alter table public.auction_watchers enable row level security;
revoke all on table public.auctions,public.bids,public.auction_watchers from public,anon,authenticated;
grant all on table public.auctions,public.bids,public.auction_watchers to service_role;

create function public.prevent_frozen_card_change()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.auctions where card_instance_id=old.id and status='active') then
    raise exception 'CARD_FROZEN' using errcode='P0001';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
create trigger user_cards_prevent_frozen_change before update or delete on public.user_cards
  for each row execute function public.prevent_frozen_card_change();

create function public.settle_expired_auctions()
returns void language plpgsql volatile security definer set search_path='' as $$
declare sale record;
begin
  for sale in select * from public.auctions where status='active' and ends_at<=clock_timestamp()
    order by ends_at for update skip locked loop
    if sale.buyer_id is null then
      update public.auctions set status='expired' where id=sale.id;
    else
      update public.auctions set status='sold' where id=sale.id;
      update public.user_cards set user_id=sale.buyer_id,folder_id=null,is_first_owner=false,date_obtention=clock_timestamp()
        where id=sale.card_instance_id;
      delete from public.wishlist where user_id=sale.buyer_id
        and card_id=(select card_id from public.user_cards where id=sale.card_instance_id);
      perform public.credit_karas(sale.seller_id,sale.current_price);
    end if;
  end loop;
end; $$;
revoke all on function public.settle_expired_auctions() from public,anon,authenticated;

create function public.create_auction(p_card_instance_id uuid,p_starting_price integer default 10,p_duration_minutes integer default 60)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); auction_id uuid;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  if p_starting_price<10 then raise exception 'INVALID_AUCTION_PRICE' using errcode='P0001'; end if;
  if p_duration_minutes not in (15,30,60,240,720,1440) then raise exception 'INVALID_AUCTION_DURATION' using errcode='P0001'; end if;
  perform 1 from public.user_cards where id=p_card_instance_id and user_id=player_id for update;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,current_price)
    values(p_card_instance_id,player_id,p_starting_price,p_duration_minutes,clock_timestamp()+make_interval(mins=>p_duration_minutes),p_starting_price)
    returning id into auction_id;
  return auction_id;
exception when unique_violation then raise exception 'CARD_FROZEN' using errcode='P0001';
end; $$;

create function public.place_bid(p_auction_id uuid,p_amount integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); sale public.auctions%rowtype; old_buyer uuid; old_price integer; balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  select * into sale from public.auctions where id=p_auction_id for update;
  if not found or sale.status<>'active' then raise exception 'AUCTION_CLOSED' using errcode='P0001'; end if;
  if sale.seller_id=player_id then raise exception 'SELLER_CANNOT_BID' using errcode='P0001'; end if;
  if p_amount<sale.current_price+10 then raise exception 'BID_TOO_LOW' using errcode='P0001'; end if;
  old_buyer:=sale.buyer_id; old_price:=sale.current_price;
  if old_buyer=player_id then balance:=public.debit_karas(player_id,p_amount-old_price);
  else
    balance:=public.debit_karas(player_id,p_amount);
    if old_buyer is not null then perform public.credit_karas(old_buyer,old_price); end if;
  end if;
  update public.auctions set current_price=p_amount,buyer_id=player_id,
    ends_at=case when ends_at-clock_timestamp()<interval '5 minutes' then ends_at+interval '1 minute' else ends_at end
    where id=p_auction_id returning * into sale;
  insert into public.bids(auction_id,bidder_id,amount) values(p_auction_id,player_id,p_amount);
  return jsonb_build_object('currentPrice',sale.current_price,'endsAt',sale.ends_at,'balance',balance);
end; $$;

create function public.toggle_auction_watch(p_auction_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); removed uuid;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  delete from public.auction_watchers where user_id=player_id and auction_id=p_auction_id returning user_id into removed;
  if removed is not null then return false; end if;
  insert into public.auction_watchers(user_id,auction_id) values(player_id,p_auction_id);
  return true;
end; $$;

create function public.list_auctions()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'rarity',c.rarete_base,'image',c.image_url,'shiny',uc.is_shiny),
    'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',p.pseudo,'sellerId',a.seller_id,
    'buyerId',a.buyer_id,'bids',(select count(*) from public.bids b where b.auction_id=a.id),
    'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
  ) order by a.ends_at),'[]'::jsonb) from public.auctions a join public.user_cards uc on uc.id=a.card_instance_id
    join public.cards c on c.id=uc.card_id join public.user_profiles p on p.user_id=a.seller_id
    where a.status='active' or a.seller_id=player_id or a.buyer_id=player_id);
end; $$;

create function public.get_auction(p_auction_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  select jsonb_build_object('id',a.id,'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'rarity',c.rarete_base,'image',c.image_url,'shiny',uc.is_shiny),
    'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',p.pseudo,'sellerId',a.seller_id,'buyerId',a.buyer_id,
    'bids',(select count(*) from public.bids b where b.auction_id=a.id),
    'winner',(select pseudo from public.user_profiles where user_id=a.buyer_id),'balance',(select karas_balance from public.user_profiles where user_id=player_id),
    'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',bp.pseudo,'amount',b.amount,'createdAt',b.created_at,'mine',b.bidder_id=player_id) order by b.created_at desc),'[]'::jsonb)
      from public.bids b join public.user_profiles bp on bp.user_id=b.bidder_id where b.auction_id=a.id)) into result
    from public.auctions a join public.user_cards uc on uc.id=a.card_instance_id join public.cards c on c.id=uc.card_id
    join public.user_profiles p on p.user_id=a.seller_id where a.id=p_auction_id;
  if result is null then raise exception 'AUCTION_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;

revoke all on function public.create_auction(uuid,integer,integer),public.place_bid(uuid,integer),
 public.toggle_auction_watch(uuid),public.list_auctions(),public.get_auction(uuid) from public,anon,authenticated;
grant execute on function public.create_auction(uuid,integer,integer),public.place_bid(uuid,integer),
 public.toggle_auction_watch(uuid),public.list_auctions(),public.get_auction(uuid) to authenticated;

commit;
