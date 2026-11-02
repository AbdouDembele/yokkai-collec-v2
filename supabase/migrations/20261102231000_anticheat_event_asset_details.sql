begin;

create function public.anticheat_event_cards(p_ids uuid[],p_snapshot jsonb)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('instanceId',item.id,
    'name',coalesce(c.nom,snapshot->>'name'),'rarity',coalesce(uc.rarity::text,snapshot->>'rarity'),
    'franchise',coalesce(c.franchise,snapshot->>'anime')) order by item.ord),'[]')
  from (select id,ord from unnest(p_ids) with ordinality x(id,ord) order by ord limit 1000)item
  left join public.user_cards uc on uc.id=item.id left join public.cards c on c.id=uc.card_id
  left join lateral(select v snapshot from jsonb_array_elements(coalesce(p_snapshot,'[]'))v
    where v->>'instanceId'=item.id::text limit 1)s on true
$$;
revoke all on function public.anticheat_event_cards(uuid[],jsonb) from public,anon,authenticated,service_role;

create function public.anticheat_build_event_assets(p_type text,p_subject uuid,p_metadata jsonb,p_amount integer)
returns jsonb language plpgsql stable set search_path='' as $$
declare trade public.trade_offers%rowtype; sale public.auctions%rowtype; card jsonb;
begin
  if p_type like 'trade_%' then
    select * into trade from public.trade_offers where id=p_subject;
    if not found then return jsonb_build_object('kind','trade','available',false); end if;
    return jsonb_build_object('kind','trade','available',true,'fromUser',trade.from_user,'toUser',trade.to_user,
      'offeredCards',public.anticheat_event_cards(trade.offered_card_ids,trade.offered_cards_snapshot),
      'requestedCards',public.anticheat_event_cards(trade.requested_card_ids,trade.requested_cards_snapshot),
      'offeredCount',coalesce((p_metadata->>'offeredCards')::integer,cardinality(trade.offered_card_ids)),
      'requestedCount',coalesce((p_metadata->>'requestedCards')::integer,cardinality(trade.requested_card_ids)),
      'offeredKaras',coalesce((p_metadata->>'offeredKaras')::integer,trade.offered_karas),
      'requestedKaras',coalesce((p_metadata->>'requestedKaras')::integer,trade.requested_karas));
  elsif p_type like 'auction_%' then
    select * into sale from public.auctions where id=p_subject;
    if not found then return jsonb_build_object('kind','auction','available',false,'amount',p_amount); end if;
    select jsonb_build_object('name',c.nom,'rarity',uc.rarity,'franchise',c.franchise) into card
      from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.id=sale.card_instance_id;
    card:=coalesce(card,case when sale.card_snapshot is not null then jsonb_build_object('name',sale.card_snapshot->>'name',
      'rarity',sale.card_snapshot->>'rarity','franchise',sale.card_snapshot->>'anime') end,
      jsonb_build_object('name',null,'rarity',null,'franchise',null));
    return jsonb_build_object('kind','auction','available',true,'cards',jsonb_build_array(card),'amount',p_amount,
      'startingPrice',coalesce((p_metadata->>'startingPrice')::integer,sale.starting_price));
  else return jsonb_build_object('kind','context','available',false); end if;
end; $$;
revoke all on function public.anticheat_build_event_assets(text,uuid,jsonb,integer) from public,anon,authenticated,service_role;

-- Save future economic details inside the already immutable, private event.
-- No account names, IP address or browser token is added to this snapshot.
create function public.anticheat_capture_event_assets()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.event_type like 'trade_%' or new.event_type like 'auction_%' then
    new.metadata:=new.metadata||jsonb_build_object('assetSnapshot',public.anticheat_build_event_assets(new.event_type,new.subject_id,new.metadata,new.amount));
  end if;
  return new;
end; $$;
revoke all on function public.anticheat_capture_event_assets() from public,anon,authenticated,service_role;
create trigger anticheat_capture_event_assets before insert on public.anticheat_events
  for each row execute function public.anticheat_capture_event_assets();

create function public.anticheat_event_asset_detail(p_event_id bigint)
returns jsonb language plpgsql stable set search_path='' as $$
declare event public.anticheat_events%rowtype; detail jsonb; source text;
begin
  select * into event from public.anticheat_events where id=p_event_id;
  if not found then return null; end if;
  if event.metadata ? 'assetSnapshot' then detail:=event.metadata->'assetSnapshot';source:='captured';
  else detail:=public.anticheat_build_event_assets(event.event_type,event.subject_id,event.metadata,event.amount);source:='retained';end if;
  if not coalesce((detail->>'available')::boolean,false) then source:='unavailable';end if;
  return detail||jsonb_build_object('source',source,
    'fromName',(select pseudo from public.user_profiles where user_id=(detail->>'fromUser')::uuid),
    'toName',(select pseudo from public.user_profiles where user_id=(detail->>'toUser')::uuid));
end; $$;
revoke all on function public.anticheat_event_asset_detail(bigint) from public,anon,authenticated,service_role;

-- Add private asset detail to the existing bounded admin reader. Its guard,
-- event-type validation, filters, pagination and grants stay unchanged.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.admin_list_anticheat_events(uuid,text,integer,integer)'::regprocedure);
  if position('''metadata'',e.metadata,' in definition)=0 then raise exception 'ANTICHEAT_READER_PATCH_MISMATCH';end if;
  definition:=replace(definition,'''metadata'',e.metadata,','''metadata'',e.metadata,''detail'',public.anticheat_event_asset_detail(e.id),');
  execute definition;
end; $$;
notify pgrst,'reload schema';
commit;
