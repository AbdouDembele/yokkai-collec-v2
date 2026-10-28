begin;

create function public.cancel_auction(p_auction_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  sale public.auctions%rowtype;
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into sale
  from public.auctions
  where id = p_auction_id
  for update;

  if not found then
    raise exception 'AUCTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if sale.seller_id <> player_id then
    raise exception 'AUCTION_NOT_OWNER' using errcode = 'P0001';
  end if;
  if sale.status <> 'active' then
    raise exception 'AUCTION_CLOSED' using errcode = 'P0001';
  end if;
  if exists(select 1 from public.bids where auction_id = p_auction_id) then
    raise exception 'AUCTION_HAS_BIDS' using errcode = 'P0001';
  end if;

  update public.auctions
  set status = 'expired', ends_at = clock_timestamp()
  where id = p_auction_id;

  return true;
end;
$$;

revoke all on function public.cancel_auction(uuid) from public, anon;
grant execute on function public.cancel_auction(uuid) to authenticated;

commit;
