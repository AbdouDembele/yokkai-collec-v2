begin;

-- Every category of a card, its main one included (cards.categorie stays the card face).
create table if not exists public.card_categories (
  card_id uuid not null references public.cards(id) on delete cascade,
  categorie text not null check (char_length(categorie) between 1 and 100),
  primary key (card_id, categorie)
);
create index if not exists card_categories_categorie_idx on public.card_categories(categorie);
alter table public.card_categories enable row level security;
revoke all on table public.card_categories from public, anon, authenticated;
grant all on table public.card_categories to service_role;

commit;
