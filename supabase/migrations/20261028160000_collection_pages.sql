-- #388 (H2a): the collection screen reads one page of groups at a time instead
-- of every copy. Same filters, search, grouping and order as the client code:
-- components/collection.tsx, lib/ui/collection-groups.ts, collection-sort.ts.
-- Read-only, own copies only (auth.uid()).
begin;

-- Matches String.localeCompare("en-US", { sensitivity: "base", numeric: true }).
create collation if not exists public.yk_card_name
  (provider=icu, locale='en-US-u-kn-ks-level1', deterministic=false);

-- One row per copy matching the filters, with its group and its global rank in
-- the sorted list. Internal: callable only by the owning wrappers below.
create function public.collection_ranked_copies(
  p_player uuid, p_query text, p_categories text[], p_rarities text[],
  p_shiny_only boolean, p_folder text, p_auction_only boolean, p_locked_only boolean, p_sort text)
returns table(group_key text, global_rank bigint, copy jsonb, newest_rank bigint)
language plpgsql stable security definer set search_path='' as $$
declare terms text[]:=array(select term from unnest(regexp_split_to_array(
  lower(btrim(regexp_replace(coalesce(p_query,''),'[,%()]',' ','g'))),'\s+')) term where term<>'');
begin
  return query
  with copies as (
    select uc.id,uc.card_id,uc.date_obtention,uc.is_shiny,uc.is_evolved,uc.is_first_owner,uc.is_locked,
      uc.folder_id,uc.custom_image_url,c.nom,c.categorie,c.franchise,c.rarete_base,c.image_url,
      exists(select 1 from public.auctions a where a.card_instance_id=uc.id and a.seller_id=p_player and a.status='active') frozen,
      case c.rarete_base::text when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end rarity_rank,
      case when uc.is_shiny then 0 else 1 end shiny_rank,
      -- JavaScript compares Date.parse() milliseconds.
      floor(extract(epoch from date_trunc('milliseconds',uc.date_obtention))*1000)::bigint obtained_ms
    from public.user_cards uc join public.cards c on c.id=uc.card_id
    where uc.user_id=p_player
  ), filtered as (
    select * from copies x
    where not exists(select 1 from unnest(terms) term where not (
        position(term in lower(x.nom))>0 or position(term in lower(x.categorie))>0
        or position(term in lower(coalesce(x.franchise,'')))>0))
      and (coalesce(cardinality(p_categories),0)=0 or x.categorie=any(p_categories))
      and (coalesce(cardinality(p_rarities),0)=0 or x.rarete_base::text=any(p_rarities))
      and (not coalesce(p_shiny_only,false) or x.is_shiny or x.is_evolved)
      and (p_folder is null or (p_folder='unfiled' and x.folder_id is null) or x.folder_id::text=p_folder)
      and (not coalesce(p_auction_only,false) or x.frozen)
      and (not coalesce(p_locked_only,false) or x.is_locked)
  )
  select x.card_id::text||':'||x.rarete_base::text||':'||case when x.is_evolved then 'evolved' when x.is_shiny then 'shiny' else 'normal' end,
    row_number() over (order by
      case p_sort when 'recent' then -x.obtained_ms when 'oldest' then x.obtained_ms end,
      case when p_sort='name' then x.nom collate public.yk_card_name end,
      x.rarity_rank, x.shiny_rank,
      case when p_sort is distinct from 'name' then x.nom collate public.yk_card_name end,
      x.id::text collate "C"),
    jsonb_build_object('instanceId',x.id,'id',x.card_id,'name',x.nom,'category',x.categorie,
      'anime',nullif(x.franchise,''),'rarity',x.rarete_base,'image',coalesce(nullif(x.custom_image_url,''),x.image_url),
      'catalogueImage',x.image_url,'customImageUrl',x.custom_image_url,'obtainedAt',x.date_obtention,
      'shiny',x.is_shiny,'isEvolved',x.is_evolved,'isFirstOwner',x.is_first_owner,'locked',x.is_locked,
      'folderId',x.folder_id,'frozen',x.frozen),
    -- Copies inside a group: newest first, then instance id (groupCollection).
    row_number() over (partition by x.card_id,x.rarete_base,x.is_evolved,x.is_shiny and not x.is_evolved
      order by x.obtained_ms desc, x.id::text collate "C")
  from filtered x;
end; $$;

-- One page of groups. p_after is the key of the last group already shown (next
-- page); without it, p_offset groups are skipped (direct page jump).
-- Returns { total, groups: [{ key, copies: [...] }], next }.
create function public.get_collection_groups_page(
  p_query text default '', p_categories text[] default null, p_rarities text[] default null,
  p_shiny_only boolean default false, p_folder text default null, p_auction_only boolean default false,
  p_locked_only boolean default false, p_sort text default 'rarity', p_after text default null,
  p_offset integer default 0, p_limit integer default 24)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid(); page_size integer:=least(60,greatest(1,coalesce(p_limit,24))); result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if coalesce(p_sort,'') not in ('rarity','recent','oldest','name') or char_length(coalesce(p_query,''))>200
    or coalesce(p_offset,0)<0 then raise exception 'COLLECTION_PAGE_INVALID' using errcode='P0001'; end if;
  with ranked as materialized (
    select * from public.collection_ranked_copies(player,p_query,p_categories,p_rarities,
      p_shiny_only,p_folder,p_auction_only,p_locked_only,p_sort)
  ), groups as (
    select group_key, min(global_rank) position,
      jsonb_agg(copy order by newest_rank) copies
    from ranked group by group_key
  ), ordered as (
    select group_key, copies, row_number() over (order by position) n from groups
  ), start as (
    select coalesce((select n from ordered where group_key=p_after),
      case when p_after is null then coalesce(p_offset,0) else 0 end) n
  ), page as (
    select * from ordered where n>(select n from start) order by n limit page_size+1
  )
  select jsonb_build_object(
    'total',(select count(*) from ordered),
    'offset',(select n from start),
    -- firstOwner covers every copy of the group, whatever the filters.
    'groups',coalesce((select jsonb_agg(jsonb_build_object('key',group_key,'copies',copies,
      'firstOwner',exists(select 1 from public.user_cards u join public.cards c on c.id=u.card_id
        where u.user_id=player and u.card_id=split_part(group_key,':',1)::uuid and c.rarete_base='LR' and u.is_first_owner
          and case split_part(group_key,':',3) when 'evolved' then u.is_evolved
            when 'shiny' then u.is_shiny and not u.is_evolved else not u.is_shiny and not u.is_evolved end)) order by n)
      from (select * from page order by n limit page_size) p),'[]'::jsonb),
    'next',case when (select count(*) from page)>page_size
      then (select group_key from page order by n offset page_size-1 limit 1) end)
  into result;
  return result;
end; $$;

-- Sidebar counters: distinct groups over the whole collection, as the client
-- counted them (rarity, category, in auction, locked, unfiled, per folder).
create function public.get_collection_counts()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid(); result jsonb;
begin
  if player is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  with copies as (
    select (uc.card_id::text||':'||c.rarete_base::text||':'||case when uc.is_evolved then 'evolved' when uc.is_shiny then 'shiny' else 'normal' end) group_key,
      c.rarete_base::text rarity, c.categorie, uc.is_locked, uc.folder_id,
      exists(select 1 from public.auctions a where a.card_instance_id=uc.id and a.seller_id=player and a.status='active') frozen
    from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.user_id=player
  )
  select jsonb_build_object(
    'copies',(select count(*) from copies),
    'groups',(select count(distinct group_key) from copies),
    'rarities',coalesce((select jsonb_object_agg(rarity,n) from (select rarity,count(distinct group_key) n from copies group by rarity) r),'{}'::jsonb),
    'categories',coalesce((select jsonb_object_agg(categorie,n) from (select categorie,count(distinct group_key) n from copies group by categorie) r),'{}'::jsonb),
    'frozen',(select count(distinct group_key) from copies where frozen),
    'locked',(select count(distinct group_key) from copies where is_locked),
    'unfiled',(select count(distinct group_key) from copies where folder_id is null),
    'folders',coalesce((select jsonb_object_agg(folder_id,n) from (select folder_id,count(distinct group_key) n from copies where folder_id is not null group by folder_id) r),'{}'::jsonb))
  into result;
  return result;
end; $$;

-- Every copy of one group, whatever the filters: detail, evolution, destruction.
create function public.get_collection_group_copies(p_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid();
begin
  if player is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_key is null or p_key !~ '^[0-9a-f-]{36}:(C|R|SR|SSR|LR):(normal|shiny|evolved)$'
    then raise exception 'COLLECTION_PAGE_INVALID' using errcode='P0001'; end if;
  return coalesce((select jsonb_agg(copy order by newest_rank)
    from public.collection_ranked_copies(player,'',null,null,false,null,false,false,'rarity')
    where group_key=p_key),'[]'::jsonb);
end; $$;

-- Binder view: one owned copy per card, the first in the old collection order
-- (rarity LR first, newest first, then instance id), for the cards on screen.
create function public.get_collection_owned_copies(p_card_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid();
begin
  if player is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if coalesce(cardinality(p_card_ids),0)>100 then raise exception 'COLLECTION_PAGE_INVALID' using errcode='P0001'; end if;
  return coalesce((select jsonb_agg(copy) from (
    select distinct on (r.copy->>'id') r.copy
    from public.collection_ranked_copies(player,'',null,null,false,null,false,false,'rarity') r
    where (r.copy->>'id')::uuid=any(p_card_ids)
    order by r.copy->>'id',
      case r.copy->>'rarity' when 'LR' then 0 when 'SSR' then 1 when 'SR' then 2 when 'R' then 3 else 4 end,
      floor(extract(epoch from date_trunc('milliseconds',(r.copy->>'obtainedAt')::timestamptz))*1000) desc,
      r.copy->>'instanceId' collate "C") owned),'[]'::jsonb);
end; $$;

-- Binder header: copies owned in a license, as the client counted them.
create function public.get_collection_license_copies(p_license text)
returns integer language plpgsql stable security definer set search_path='' as $$
declare player uuid:=auth.uid();
begin
  if player is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select count(*)::integer from public.user_cards uc join public.cards c on c.id=uc.card_id
    where uc.user_id=player and case when upper(btrim(c.categorie)) in ('ARTIST','BRAINROT','DISNEY CHANNEL','FILM',
      'INTERNET PERSONALITY','KDRAMA','KPOP','MEME','VOCALOID','WWE')
      then upper(btrim(c.categorie))=upper(coalesce(p_license,'')) else btrim(coalesce(c.franchise,''))=p_license end);
end; $$;

revoke all on function public.collection_ranked_copies(uuid,text,text[],text[],boolean,text,boolean,boolean,text),
  public.get_collection_groups_page(text,text[],text[],boolean,text,boolean,boolean,text,text,integer,integer),
  public.get_collection_counts(),public.get_collection_group_copies(text),
  public.get_collection_owned_copies(uuid[]),public.get_collection_license_copies(text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_collection_groups_page(text,text[],text[],boolean,text,boolean,boolean,text,text,integer,integer),
  public.get_collection_counts(),public.get_collection_group_copies(text),
  public.get_collection_owned_copies(uuid[]),public.get_collection_license_copies(text) to authenticated;
notify pgrst,'reload schema';
commit;
