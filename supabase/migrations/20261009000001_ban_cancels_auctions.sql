begin;

create or replace function public.admin_set_user_ban(p_user_id uuid,p_banned boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  sale public.auctions%rowtype;
  cancelled_sales integer:=0;
  reset_auctions integer:=0;
  removed_bids integer:=0;
  affected integer:=0;
  refunded_karas bigint:=0;
begin
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  if p_user_id=auth.uid() then raise exception 'CANNOT_BAN_SELF' using errcode='P0001'; end if;
  if exists(select 1 from public.admin_users where user_id=p_user_id) then raise exception 'CANNOT_BAN_ADMIN' using errcode='P0001'; end if;
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'PLAYER_NOT_FOUND' using errcode='P0001'; end if;

  if p_banned then
    -- A banned seller must no longer have a live sale. Deleting the auction also
    -- removes its bids, watchers, chat and auction-linked notifications by cascade.
    for sale in
      select * from public.auctions
      where seller_id=p_user_id and status='active'
      order by id for update
    loop
      if sale.buyer_id is not null then
        perform public.credit_karas(sale.buyer_id,sale.current_price);
        refunded_karas:=refunded_karas+sale.current_price;
      end if;
      delete from public.auctions where id=sale.id;
      update public.user_cards set is_locked=false where id=sale.card_instance_id;
      cancelled_sales:=cancelled_sales+1;
    end loop;

    -- Only the current winner has Karas held. Restoring a previous bidder would
    -- debit them again without consent, so the sale restarts cleanly instead.
    for sale in
      select * from public.auctions
      where buyer_id=p_user_id and status='active'
      order by id for update
    loop
      perform public.credit_karas(p_user_id,sale.current_price);
      refunded_karas:=refunded_karas+sale.current_price;
      delete from public.bids where auction_id=sale.id;
      get diagnostics affected=row_count;
      removed_bids:=removed_bids+affected;
      update public.auctions
      set buyer_id=null,current_price=starting_price
      where id=sale.id;
      reset_auctions:=reset_auctions+1;
    end loop;

    -- Remove any remaining losing bid history from this account.
    delete from public.bids where bidder_id=p_user_id;
    get diagnostics affected=row_count;
    removed_bids:=removed_bids+affected;
  end if;

  update auth.users
  set banned_until=case when p_banned then 'infinity'::timestamptz else null end,updated_at=now()
  where id=p_user_id;
  if p_banned then delete from auth.sessions where user_id=p_user_id; end if;

  insert into public.admin_audit_logs(admin_user_id,action,metadata)
  values(auth.uid(),case when p_banned then 'player.ban' else 'player.unban' end,jsonb_build_object(
    'target_user_id',p_user_id,
    'cancelled_sales',cancelled_sales,
    'reset_auctions',reset_auctions,
    'removed_bids',removed_bids,
    'refunded_karas',refunded_karas
  ));
end; $$;

revoke all on function public.admin_set_user_ban(uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_set_user_ban(uuid,boolean) to authenticated;

commit;
