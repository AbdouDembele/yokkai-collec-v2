-- Keep category achievement checks from rescanning the full card catalogue.
-- CONCURRENTLY cannot run inside a transaction.
create index concurrently if not exists cards_categorie_idx
  on public.cards (categorie);
