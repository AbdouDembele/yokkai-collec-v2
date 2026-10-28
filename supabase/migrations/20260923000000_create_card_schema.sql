begin;

create type public.card_rarity as enum ('C', 'R', 'SR', 'SSR', 'LR');

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  nom text not null,
  categorie text not null,
  franchise text not null,
  franchise_romaji text,
  rarete_base public.card_rarity not null,
  image_url text not null,
  favoris_count integer,
  description text,
  source text not null,
  date_ajout timestamptz not null default now(),
  constraint cards_source_source_id_key unique (source, source_id),
  constraint cards_favoris_count_nonnegative check (favoris_count >= 0)
);

create table public.user_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete restrict,
  date_obtention timestamptz not null default now()
);

-- No UNIQUE (user_id, card_id): each duplicate is an independent owned copy.
create index user_cards_user_date_idx
  on public.user_cards (user_id, date_obtention desc);
create index user_cards_card_id_idx on public.user_cards (card_id);
create index cards_rarete_base_idx on public.cards (rarete_base);

create table public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pseudo text not null check (length(btrim(pseudo)) > 0),
  next_regular_pack_at timestamptz not null default now()
);

-- The timestamp represents the earliest unconsumed pack's availability.
-- This also permits retaining v0.1's three-pack cap without an extra column.
comment on column public.user_profiles.next_regular_pack_at is
  'Availability of the earliest unconsumed Regular Pack. Initially now(): one pack. Every 30 min, up to three packs; updated only by the server-side pack transaction.';

alter table public.cards enable row level security;
alter table public.user_cards enable row level security;
alter table public.user_profiles enable row level security;

-- Explicit grants also override permissive defaults on existing projects.
revoke all on table public.cards, public.user_cards, public.user_profiles
  from public, anon, authenticated;
grant select on table public.cards to anon, authenticated;
grant select on table public.user_cards, public.user_profiles to authenticated;
grant all on table public.cards, public.user_cards, public.user_profiles to service_role;

create policy cards_read_catalogue on public.cards
  for select to anon, authenticated using (true);

create policy user_cards_read_own on public.user_cards
  for select to authenticated using ((select auth.uid()) = user_id);

create policy user_profiles_read_own on public.user_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

-- Client writes are deliberately unavailable: the later openBooster RPC will
-- atomically check the timer, draw cards, insert copies and update the timer.

commit;
