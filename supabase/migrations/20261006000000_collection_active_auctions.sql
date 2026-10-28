begin;

create function public.get_my_active_auction_cards()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  perform public.settle_expired_auctions();

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'instanceId', a.card_instance_id,
      'auctionId', a.id,
      'endsAt', a.ends_at
    ) order by a.ends_at), '[]'::jsonb)
    from public.auctions a
    where a.seller_id = player_id
      and a.status = 'active'
      and a.card_instance_id is not null
  );
end;
$$;

revoke all on function public.get_my_active_auction_cards() from public, anon;
grant execute on function public.get_my_active_auction_cards() to authenticated;

commit;
