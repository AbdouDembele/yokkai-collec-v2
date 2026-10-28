begin;

alter table public.user_cards
  add column custom_image_url text
  check (custom_image_url is null or (
    char_length(custom_image_url) <= 2048
    and custom_image_url ~* '^https://(i\.)?imgur\.com/[^[:space:]]+$'
  ));

create or replace function public.profile_card_json(c public.cards,uc public.user_cards)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
    'rarity',c.rarete_base,'image',coalesce(uc.custom_image_url,c.image_url),'catalogueImage',c.image_url,
    'customImageUrl',uc.custom_image_url,'instanceId',uc.id,'obtainedAt',uc.date_obtention,
    'shiny',uc.is_shiny,'isEvolved',uc.is_evolved,'isFirstOwner',uc.is_first_owner,'folderId',uc.folder_id)
$$;

create or replace function public.set_card_custom_image(p_card_instance_id uuid,p_image_url text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); cleaned_url text:=nullif(btrim(p_image_url),''); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if cleaned_url is not null and (char_length(cleaned_url)>2048
      or cleaned_url !~* '^https://(i\.)?imgur\.com/[^[:space:]]+$') then
    raise exception 'INVALID_IMGUR_URL' using errcode='P0001';
  end if;
  update public.user_cards set custom_image_url=cleaned_url
    where id=p_card_instance_id and user_id=player_id;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  select public.profile_card_json(c,uc) into result from public.user_cards uc
    join public.cards c on c.id=uc.card_id where uc.id=p_card_instance_id;
  return result;
end; $$;
revoke all on function public.set_card_custom_image(uuid,text) from public,anon,authenticated;
grant execute on function public.set_card_custom_image(uuid,text) to authenticated;

create or replace function public.list_auctions()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'rarity',c.rarete_base,
      'image',coalesce(uc.custom_image_url,c.image_url),'catalogueImage',c.image_url,'customImageUrl',uc.custom_image_url,'shiny',uc.is_shiny),
    'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',p.pseudo,'sellerId',a.seller_id,
    'buyerId',a.buyer_id,'bids',(select count(*) from public.bids b where b.auction_id=a.id),
    'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
  ) order by a.ends_at),'[]'::jsonb) from public.auctions a join public.user_cards uc on uc.id=a.card_instance_id
    join public.cards c on c.id=uc.card_id join public.user_profiles p on p.user_id=a.seller_id
    where a.status='active' or a.seller_id=player_id or a.buyer_id=player_id);
end; $$;

create or replace function public.get_auction(p_auction_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); result jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  perform public.settle_expired_auctions();
  select jsonb_build_object('id',a.id,'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'rarity',c.rarete_base,
      'image',coalesce(uc.custom_image_url,c.image_url),'catalogueImage',c.image_url,'customImageUrl',uc.custom_image_url,'shiny',uc.is_shiny),
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

commit;
