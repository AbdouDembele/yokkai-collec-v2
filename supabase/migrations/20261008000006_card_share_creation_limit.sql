begin;

-- Append creation events independently of active links; only retention removes them.
create table public.card_share_creations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index card_share_creations_owner_created_idx
  on public.card_share_creations(owner_id, created_at);

alter table public.card_share_creations enable row level security;
revoke all on table public.card_share_creations from public, anon, authenticated, service_role;

-- Seed today's existing shares so applying the migration does not reset the cap.
insert into public.card_share_creations (owner_id, created_at)
select owner_id, created_at from public.card_shares
where created_at >= pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC') at time zone 'UTC';

create or replace function public.create_card_share(p_instance_id uuid, p_show_pseudo boolean default false)
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

  -- Retention is per player and runs under the same transaction lock.
  delete from public.card_share_creations
  where owner_id = player_id and created_at < pg_catalog.now() - interval '7 days';

  select share.id into existing_id
  from public.card_shares share
  where share.owner_id = player_id
    and share.card_id = snapshot.card_id
    and share.shiny = snapshot.is_shiny
    and share.show_pseudo = coalesce(p_show_pseudo, false);
  if existing_id is not null then return existing_id; end if;

  if (select count(*) from public.card_share_creations creation
      where creation.owner_id = player_id
        and creation.created_at >= pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC') at time zone 'UTC') >= 10
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
  insert into public.card_share_creations (owner_id) values (player_id);
  return new_id;
end;
$$;

commit;
