begin;
do $$ begin
  if not exists(select 1 from cron.job where active and schedule='* * * * *'
    and command ilike '%settle_expired_auctions%') then
    raise exception 'SETTLEMENT_CRON_REQUIRED';
  end if;
end $$;
-- The minutely cron owns settlement. Listing never locks unrelated sellers.
-- Keep the existing Basic/Pro/Admin-Pro caps and ignore elapsed listings.
CREATE OR REPLACE FUNCTION public.create_auction(p_card_instance_id uuid, p_starting_price integer DEFAULT 10, p_duration_minutes integer DEFAULT 60)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare player uuid:=auth.uid(); auction_id uuid; card_locked boolean; cap integer;
begin
  perform public.assert_player_not_banned();
  if player is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_starting_price<10 then raise exception 'INVALID_AUCTION_PRICE'; end if;
  if p_duration_minutes not in (15,30,60,240,720,1440) then raise exception 'INVALID_AUCTION_DURATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pro-auction-limit:'||player::text,0));
  select is_locked into card_locked from public.user_cards where id=p_card_instance_id and user_id=player for update;
  if not found then raise exception 'CARD_NOT_OWNED'; end if;
  if card_locked then raise exception 'CARD_LOCKED'; end if;
  if exists(select 1 from public.auctions where card_instance_id=p_card_instance_id and status='active') then raise exception 'CARD_FROZEN'; end if;
  cap:=case when not public.billing_has_game_pro(player) then 3
    when public.is_current_user_admin() then null else 6 end;
  if cap is not null and (select count(*) from public.auctions where seller_id=player and status='active' and ends_at>clock_timestamp())>=cap
    then raise exception 'AUCTION_LIMIT_REACHED'; end if;
  update public.user_cards set custom_image_url=null where id=p_card_instance_id;
  insert into public.auctions(card_instance_id,seller_id,starting_price,duration_minutes,ends_at,current_price)
    values(p_card_instance_id,player,p_starting_price,p_duration_minutes,clock_timestamp()+make_interval(mins=>p_duration_minutes),p_starting_price)
    returning id into auction_id;
  return auction_id;
exception when unique_violation then raise exception 'CARD_FROZEN';
end; $function$
;
revoke all on function public.create_auction(uuid,integer,integer) from public,anon,service_role;
grant execute on function public.create_auction(uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
