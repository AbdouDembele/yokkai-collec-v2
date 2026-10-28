begin;

create table public.card_shares (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  card_id uuid not null references public.cards(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete cascade,
  card_name text not null check (length(btrim(card_name)) > 0),
  franchise text not null,
  rarity public.card_rarity not null,
  shiny boolean not null,
  show_pseudo boolean not null default false,
  catalogue_image_url text not null check (catalogue_image_url ~ '^https://'),
  display_pseudo text,
  created_at timestamptz not null default now(),
  constraint card_shares_id_format check (id ~ '^[0-9a-f]{32}$'),
  constraint card_shares_pseudo_consistent check (
    (show_pseudo and display_pseudo is not null) or
    (not show_pseudo and display_pseudo is null)
  )
);

create unique index card_shares_combination_key
  on public.card_shares(owner_id, card_id, shiny, show_pseudo);
create index card_shares_owner_created_idx
  on public.card_shares(owner_id, created_at);

alter table public.card_shares enable row level security;
revoke all on table public.card_shares from public, anon, authenticated;
grant all on table public.card_shares to service_role;

create function public.create_card_share(p_instance_id uuid, p_show_pseudo boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  snapshot record;
  existing_id text;
  new_id text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Serialize creation per player so concurrent requests cannot bypass the daily cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(player_id::text, 0));

  select owned.card_id, owned.is_shiny, card.nom, card.franchise,
    card.rarete_base, card.image_url, profile.pseudo
  into snapshot
  from public.user_cards owned
  join public.cards card on card.id = owned.card_id
  join public.user_profiles profile on profile.user_id = owned.user_id
  where owned.id = p_instance_id and owned.user_id = player_id;
  if not found then raise exception 'CARD_NOT_OWNED'; end if;

  select share.id into existing_id
  from public.card_shares share
  where share.owner_id = player_id
    and share.card_id = snapshot.card_id
    and share.shiny = snapshot.is_shiny
    and share.show_pseudo = coalesce(p_show_pseudo, false);
  if existing_id is not null then return existing_id; end if;

  if (select count(*) from public.card_shares share
      where share.owner_id = player_id
        and share.created_at >= pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC') at time zone 'UTC') >= 10
  then
    raise exception 'CARD_SHARE_DAILY_LIMIT';
  end if;

  insert into public.card_shares (
    card_id, owner_id, card_name, franchise, rarity, shiny, show_pseudo,
    catalogue_image_url, display_pseudo
  ) values (
    snapshot.card_id, player_id, snapshot.nom, snapshot.franchise,
    snapshot.rarete_base, snapshot.is_shiny, coalesce(p_show_pseudo, false),
    snapshot.image_url, case when coalesce(p_show_pseudo, false) then snapshot.pseudo end
  ) returning id into new_id;
  return new_id;
end;
$$;

create function public.get_shared_card(p_share_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if p_share_id is null or pg_catalog.length(p_share_id) <> 32
    or p_share_id !~ '^[0-9a-f]{32}$'
  then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
    'cardName', share.card_name,
    'franchise', share.franchise,
    'rarity', share.rarity,
    'shiny', share.shiny,
    'catalogueImageUrl', share.catalogue_image_url
  ) || case when share.display_pseudo is null then '{}'::jsonb else
    pg_catalog.jsonb_build_object('pseudo', share.display_pseudo) end
  into result
  from public.card_shares share
  where share.id = p_share_id;
  return result;
end;
$$;

create function public.delete_card_share(p_share_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_share_id is null or pg_catalog.length(p_share_id) <> 32
    or p_share_id !~ '^[0-9a-f]{32}$'
  then
    return false;
  end if;

  delete from public.card_shares
  where id = p_share_id and owner_id = auth.uid();
  return found;
end;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC on new functions by default. Older
-- trigger helpers may therefore be reported as executable by anon even though
-- they are not public RPCs. Close that inherited surface before allowlisting
-- the only two intentional anonymous functions.
do $$
declare
  candidate record;
begin
  for candidate in
    select namespace.nspname, procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) as arguments
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not (
        procedure.proname = 'is_pseudo_available'
        and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'p_pseudo text'
      )
      and not (
        procedure.proname = 'get_shared_card'
        and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'p_share_id text'
      )
  loop
    execute pg_catalog.format(
      'revoke execute on function %I.%I(%s) from public, anon',
      candidate.nspname,
      candidate.proname,
      candidate.arguments
    );
  end loop;
end;
$$;

revoke all on function public.create_card_share(uuid, boolean),
  public.get_shared_card(text), public.delete_card_share(text)
from public, anon, authenticated;
grant execute on function public.create_card_share(uuid, boolean),
  public.delete_card_share(text) to authenticated;
grant execute on function public.get_shared_card(text) to anon, authenticated;

commit;
