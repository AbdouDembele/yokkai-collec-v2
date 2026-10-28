begin;

-- Bounded prefixes are re-read on polling: mutable prices/ends_at cannot skip rows.
-- Legacy list_auctions() and list_auctions_page() remain available unchanged.
create function public.browse_auctions_page(
  p_limit integer default 100, p_query text default '', p_rarity text default '',
  p_category text default '', p_sort text default 'end', p_section text default 'active'
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'INVALID_PAGE_SIZE' using errcode='P0001'; end if;
  if p_sort is null or p_sort not in ('end','asc','desc','popular') or p_section is null or p_section not in ('active','mine','won','sold') then
    raise exception 'INVALID_MARKET_FILTER' using errcode='P0001';
  end if;
  return (with player_bids as materialized (
    select distinct b.auction_id from public.bids b where b.bidder_id=player_id
  ), candidates as materialized (
    select a.*,c.id card_id,c.nom,c.franchise,c.categorie,c.rarete_base,c.image_url,uc.is_shiny,
      coalesce(c.favoris_count,0) popularity,p.pseudo,p.avatar_url,pb.auction_id is not null has_bid,
      coalesce(c.nom,a.card_snapshot->>'name') search_name,
      case when c.id is not null then c.franchise
        when a.card_snapshot->'liveFranchise'='true'::jsonb then a.card_snapshot->>'anime'
        else snapshot_card.franchise end search_anime,
      coalesce(c.categorie,a.card_snapshot->>'category') category,
      coalesce(c.rarete_base::text,a.card_snapshot->>'rarity') rarity,
      greatest(0,ceil(extract(epoch from a.ends_at-statement_timestamp()))) end_key
    from public.auctions a
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.cards snapshot_card on c.id is null and snapshot_card.id=(a.card_snapshot->>'id')::uuid
    left join public.user_profiles p on p.user_id=a.seller_id
    left join player_bids pb on pb.auction_id=a.id
    where (c.id is not null or a.card_snapshot is not null)
      and (a.status='active' or a.seller_id=player_id or a.buyer_id=player_id or pb.auction_id is not null)
  ), section_rows as (
    select * from candidates a where case p_section
      when 'active' then a.status='active'
      when 'mine' then a.status='active' and (a.seller_id=player_id or a.has_bid)
      when 'won' then a.status='sold' and a.buyer_id=player_id
      when 'sold' then a.status<>'active' and a.seller_id=player_id end
  ), terms as (
    -- Match cardSearchTerms: punctuation becomes whitespace, no accent folding,
    -- and every term is a literal substring in either the name or franchise.
    select term from regexp_split_to_table(lower(translate(coalesce(p_query,''),',%()','    ')),
      U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+') term where term<>''
  ), limited as materialized (
    select a.*,case p_sort when 'asc' then a.current_price when 'desc' then -a.current_price when 'popular' then -a.popularity else a.end_key end sort_key,
      case when p_sort='popular' then a.end_key else 0 end tie_key
    from section_rows a
    where (coalesce(p_rarity,'')='' or a.rarity=p_rarity)
      and (coalesce(p_category,'')='' or a.category=p_category)
      and not exists(select 1 from terms t where strpos(lower(coalesce(a.search_name,'')),t.term)=0 and strpos(lower(coalesce(a.search_anime,'')),t.term)=0)
    order by sort_key,tie_key,a.id limit p_limit+1
  ), page as (select * from limited order by sort_key,tie_key,id limit p_limit)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'card',case when a.card_id is not null then jsonb_build_object(
        'id',a.card_id,'name',a.nom,'category',a.categorie,'liveFranchise',true,'anime',a.franchise,
        'rarity',a.rarete_base,'image',a.image_url,'catalogueImage',a.image_url,'shiny',a.is_shiny) else a.card_snapshot||jsonb_build_object('anime',a.search_anime,'liveFranchise',true) end,
      'amount',a.current_price,'endsAt',a.ends_at,'status',a.status,'seller',coalesce(a.pseudo,'Deleted player'),'sellerId',a.seller_id,
      'sellerAvatarUrl',a.avatar_url,'buyerId',a.buyer_id,'hasBid',a.has_bid,'popularity',a.popularity,
      'bids',(select count(*) from public.bids b where b.auction_id=a.id),
      'watched',exists(select 1 from public.auction_watchers w where w.auction_id=a.id and w.user_id=player_id)
    ) order by a.sort_key,a.tie_key,a.id) from page a),'[]'::jsonb),
    'hasMore',(select count(*)>p_limit from limited),
    'categories',coalesce((select jsonb_agg(category order by category) from (select distinct category from section_rows where category is not null) categories),'[]'::jsonb),
    'counts',(select jsonb_build_object('active',count(*) filter(where status='active'),
      'mine',count(*) filter(where status='active' and (seller_id=player_id or has_bid)),
      'won',count(*) filter(where status='sold' and buyer_id=player_id),
      'sold',count(*) filter(where status<>'active' and seller_id=player_id),
      'activeSales',count(*) filter(where status='active' and seller_id=player_id)) from candidates)
  ));
end; $function$;

revoke all on function public.browse_auctions_page(integer,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.browse_auctions_page(integer,text,text,text,text,text) to authenticated;

commit;
