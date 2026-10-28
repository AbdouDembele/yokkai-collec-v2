begin;

-- The collection groundwork used a singular placeholder. Keep a writable
-- compatibility view for already-deployed RPCs while exposing the final name.
alter table public.wishlist rename to wishlists;
alter index public.wishlist_pkey rename to wishlists_pkey;
alter policy wishlist_read_own on public.wishlists rename to wishlists_read_own;
create view public.wishlist with (security_invoker=true) as select * from public.wishlists;

alter trigger user_cards_remove_wishlist on public.user_cards rename to user_cards_remove_wishlists;
create or replace function public.remove_owned_card_from_wishlist()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  delete from public.wishlists where user_id=new.user_id and card_id=new.card_id;
  return new;
end; $$;
drop trigger user_cards_remove_wishlists on public.user_cards;
create trigger user_cards_remove_wishlists
  after insert or update of user_id,card_id on public.user_cards for each row
  execute function public.remove_owned_card_from_wishlist();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('wishlist_card_on_auction')),
  reference_id uuid not null references public.auctions(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,type,reference_id)
);
create index notifications_user_created_idx on public.notifications(user_id,created_at desc);
create index notifications_user_unread_idx on public.notifications(user_id,created_at desc) where read_at is null;
alter table public.notifications enable row level security;
revoke all on table public.notifications from public,anon,authenticated;
grant select,update(read_at) on public.notifications to authenticated;
grant all on table public.notifications to service_role;
create policy notifications_read_own on public.notifications for select to authenticated
  using ((select auth.uid())=user_id);
create policy notifications_update_own on public.notifications for update to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create function public.notify_wishlist_auction()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.notifications(user_id,type,reference_id)
  select w.user_id,'wishlist_card_on_auction',new.id
  from public.wishlists w join public.user_cards uc on uc.id=new.card_instance_id
  where w.card_id=uc.card_id and w.user_id<>new.seller_id
  on conflict do nothing;
  return new;
end; $$;
revoke all on function public.notify_wishlist_auction() from public,anon,authenticated;
create trigger auctions_notify_wishlists after insert on public.auctions
  for each row execute function public.notify_wishlist_auction();

create or replace function public.search_cards(p_query text default '',p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=btrim(coalesce(p_query,'')); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),60);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
    'rarity',c.rarete_base,'image',c.image_url,'wishlisted',c.wishlisted
  ) order by c.rank,lower(c.nom),c.id),'[]'::jsonb)
  from (select cards.*,
      exists(select 1 from public.wishlists w where w.user_id=auth.uid() and w.card_id=cards.id) wishlisted,
      case
        when translate(lower(nom),'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ','aaaaaaceeeeiiiinooooouuuuyyoe')
          =translate(lower(query),'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ','aaaaaaceeeeiiiinooooouuuuyyoe') then 0
        when translate(lower(nom),'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ','aaaaaaceeeeiiiinooooouuuuyyoe')
          like translate(lower(query),'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ','aaaaaaceeeeiiiinooooouuuuyyoe')||'%' then 1 else 2 end rank
    from public.cards where query='' or
      translate(lower(nom),'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ','aaaaaaceeeeiiiinooooouuuuyyoe') like '%'||translate(lower(query),'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ','aaaaaaceeeeiiiinooooouuuuyyoe')||'%'
    order by rank,lower(nom),id limit safe_limit) c);
end; $$;

create function public.toggle_wishlist(p_card_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); removed uuid;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.cards where id=p_card_id) then raise exception 'CARD_NOT_FOUND' using errcode='P0001'; end if;
  delete from public.wishlists where user_id=player_id and card_id=p_card_id returning card_id into removed;
  if removed is not null then return false; end if;
  if exists(select 1 from public.user_cards where user_id=player_id and card_id=p_card_id) then
    raise exception 'CARD_ALREADY_OWNED' using errcode='P0001';
  end if;
  insert into public.wishlists(user_id,card_id) values(player_id,p_card_id);
  return true;
end; $$;

create function public.get_card_discovery(p_card_id uuid,p_owner_offset integer default 0,p_owner_limit integer default 12)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); result jsonb; safe_limit integer:=least(greatest(coalesce(p_owner_limit,12),1),30); safe_offset integer:=greatest(coalesce(p_owner_offset,0),0);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select jsonb_build_object(
    'card',jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url),
    'marketValue',(select avg(a.current_price)::numeric(12,2) from public.auctions a join public.user_cards sold_uc on sold_uc.id=a.card_instance_id where a.status='sold' and sold_uc.card_id=c.id),
    'activeAuctionId',(select a.id from public.auctions a join public.user_cards auc_uc on auc_uc.id=a.card_instance_id where a.status='active' and auc_uc.card_id=c.id order by a.ends_at limit 1),
    'wishlisted',exists(select 1 from public.wishlists w where w.user_id=player_id and w.card_id=c.id),
    'ownerCount',(select count(distinct uc.user_id) from public.user_cards uc where uc.card_id=c.id),
    'owners',coalesce((select jsonb_agg(jsonb_build_object('id',owners.user_id,'pseudo',owners.pseudo,'copies',owners.copies) order by owners.pseudo,owners.user_id)
      from (select uc.user_id,p.pseudo,count(*) copies from public.user_cards uc join public.user_profiles p on p.user_id=uc.user_id
        where uc.card_id=c.id group by uc.user_id,p.pseudo order by p.pseudo,uc.user_id offset safe_offset limit safe_limit) owners),'[]'::jsonb)
  ) into result from public.cards c where c.id=p_card_id;
  if result is null then raise exception 'CARD_NOT_FOUND' using errcode='P0001'; end if;
  return result;
end; $$;

create function public.list_wishlist(p_identifier text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); target_id uuid;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_identifier is null or btrim(p_identifier)='' then target_id:=viewer;
  else select user_id into target_id from public.user_profiles where lower(pseudo)=lower(btrim(p_identifier)) or user_id=case when p_identifier~*'^[0-9a-f-]{36}$' then p_identifier::uuid else null end limit 1;
  end if;
  if target_id is null then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url,'createdAt',w.created_at) order by w.created_at desc),'[]'::jsonb)
    from public.wishlists w join public.cards c on c.id=w.card_id where w.user_id=target_id);
end; $$;

create function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'type',n.type,'referenceId',n.reference_id,'readAt',n.read_at,'createdAt',n.created_at,'cardName',c.nom) order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id order by created_at desc limit safe_limit) n
    join public.auctions a on a.id=n.reference_id join public.user_cards uc on uc.id=a.card_instance_id join public.cards c on c.id=uc.card_id);
end; $$;

create function public.mark_notification_read(p_notification_id uuid default null)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); affected integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  update public.notifications set read_at=coalesce(read_at,clock_timestamp()) where user_id=player_id and (p_notification_id is null or id=p_notification_id);
  get diagnostics affected=row_count; return affected;
end; $$;

revoke all on function public.toggle_wishlist(uuid),public.get_card_discovery(uuid,integer,integer),public.list_wishlist(text),public.list_notifications(integer),public.mark_notification_read(uuid) from public,anon,authenticated;
grant execute on function public.toggle_wishlist(uuid),public.get_card_discovery(uuid,integer,integer),public.list_wishlist(text),public.list_notifications(integer),public.mark_notification_read(uuid) to authenticated;

commit;
