begin;

-- Transactional indexes: fail rather than hold catalogue writes for a long time.
set local lock_timeout='1s';
set local statement_timeout='10s';
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index cards_nom_trgm on public.cards using gin(nom extensions.gin_trgm_ops);
create index cards_franchise_trgm on public.cards using gin(franchise extensions.gin_trgm_ops);

commit;
