begin;

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nom text not null check (length(btrim(nom)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, nom)
);

alter table public.user_cards
  add column folder_id uuid,
  add column is_first_owner boolean not null default false,
  add constraint user_cards_folder_owner_fk foreign key (user_id, folder_id)
    references public.folders (user_id, id);

-- Existing non-evolved LR copies came from packs before provenance was recorded.
update public.user_cards set is_first_owner = true
  where rarity = 'LR' and not is_evolved;

create table public.wishlist (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

alter table public.folders enable row level security;
alter table public.wishlist enable row level security;
revoke all on table public.folders, public.wishlist from public, anon, authenticated;
grant select on table public.folders, public.wishlist to authenticated;
grant all on table public.folders, public.wishlist to service_role;
create policy folders_read_own on public.folders for select to authenticated
  using ((select auth.uid()) = user_id);
create policy wishlist_read_own on public.wishlist for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.remove_owned_card_from_wishlist()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.wishlist where user_id = new.user_id and card_id = new.card_id;
  return new;
end;
$$;
revoke all on function public.remove_owned_card_from_wishlist() from public, anon, authenticated;
create trigger user_cards_remove_wishlist
  after insert on public.user_cards for each row
  execute function public.remove_owned_card_from_wishlist();

create function public.create_folder(p_name text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare player_id uuid := auth.uid(); created public.folders%rowtype;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  insert into public.folders (user_id, nom) values (player_id, btrim(p_name)) returning * into created;
  return jsonb_build_object('id', created.id, 'name', created.nom);
exception when unique_violation then
  raise exception 'FOLDER_NAME_TAKEN' using errcode = 'P0001';
end;
$$;

create function public.delete_folder(p_folder_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  update public.user_cards set folder_id = null
    where folder_id = p_folder_id and user_id = auth.uid();
  delete from public.folders where id = p_folder_id and user_id = auth.uid();
  if not found then raise exception 'FOLDER_NOT_FOUND' using errcode = 'P0001'; end if;
end;
$$;

create function public.move_card_to_folder(p_card_instance_id uuid, p_folder_id uuid default null)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if p_folder_id is not null and not exists (
    select 1 from public.folders where id = p_folder_id and user_id = auth.uid()
  ) then raise exception 'FOLDER_NOT_FOUND' using errcode = 'P0001'; end if;
  update public.user_cards set folder_id = p_folder_id
    where id = p_card_instance_id and user_id = auth.uid();
  if not found then raise exception 'CARD_NOT_OWNED' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.create_folder(text), public.delete_folder(uuid),
  public.move_card_to_folder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_folder(text), public.delete_folder(uuid),
  public.move_card_to_folder(uuid, uuid) to authenticated;

create or replace function public.open_regular_pack()
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid(); deadline timestamptz; server_now timestamptz;
  pool_sizes bigint[]; rarity_index integer;
  rarities public.card_rarity[] := array['C', 'R', 'SR', 'SSR', 'LR']::public.card_rarity[];
  roll double precision; shiny boolean; selected_card public.cards%rowtype;
  copy_id uuid; result jsonb := '[]'::jsonb;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select next_regular_pack_at into deadline from public.user_profiles where user_id = player_id for update;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  server_now := clock_timestamp();
  if deadline > server_now then raise exception 'PACK_NOT_READY' using errcode = 'P0001'; end if;
  select array[count(*) filter (where rarete_base='C'),count(*) filter (where rarete_base='R'),
    count(*) filter (where rarete_base='SR'),count(*) filter (where rarete_base='SSR'),
    count(*) filter (where rarete_base='LR')] into pool_sizes from public.cards;
  if 0 = any(pool_sizes) then raise exception 'CATALOGUE_INCOMPLETE' using errcode = 'P0001'; end if;
  for position in 1..5 loop
    roll := random();
    rarity_index := case when roll<.59 then 1 when roll<.84 then 2 when roll<.94 then 3 when roll<.99 then 4 else 5 end;
    select * into selected_card from public.cards where rarete_base=rarities[rarity_index]
      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;
    shiny := selected_card.rarete_base='LR' and random()<.05;
    insert into public.user_cards (user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
      values (player_id,selected_card.id,server_now,selected_card.rarete_base,shiny,false,selected_card.rarete_base='LR') returning id into copy_id;
    result := result || jsonb_build_array(jsonb_build_object('id',selected_card.id,'name',selected_card.nom,
      'category',selected_card.categorie,'rarity',selected_card.rarete_base,'image',selected_card.image_url,
      'instanceId',copy_id,'obtainedAt',server_now,'shiny',shiny,'isEvolved',false,
      'isFirstOwner',selected_card.rarete_base='LR','folderId',null));
  end loop;
  update public.user_profiles set next_regular_pack_at=greatest(deadline,server_now-interval '60 minutes')+interval '15 minutes'
    where user_id=player_id;
  return result;
end;
$$;

create or replace function public.keep_decision_pack_card(p_choice_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare player_id uuid := auth.uid(); choice record; copy_id uuid; kept_at timestamptz := clock_timestamp();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select choices.*,cards.nom,cards.categorie,cards.image_url into choice
    from public.decision_pack_choices choices join public.decision_packs packs on packs.id=choices.pack_id
    join public.cards cards on cards.id=choices.card_id
    where choices.id=p_choice_id and packs.user_id=player_id and packs.status='pending'
    for update of packs,choices;
  if not found or choice.is_discarded then raise exception 'DECISION_CHOICE_UNAVAILABLE' using errcode='P0001'; end if;
  insert into public.user_cards (user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    values (player_id,choice.card_id,kept_at,choice.rarity,choice.is_shiny,false,choice.rarity='LR') returning id into copy_id;
  update public.decision_packs set status='claimed',claimed_at=kept_at,kept_choice_id=choice.id where id=choice.pack_id;
  return jsonb_build_object('id',choice.card_id,'name',choice.nom,'category',choice.categorie,
    'rarity',choice.rarity,'image',choice.image_url,'instanceId',copy_id,'obtainedAt',kept_at,
    'shiny',choice.is_shiny,'isEvolved',false,'isFirstOwner',choice.rarity='LR','folderId',null);
end;
$$;

commit;
