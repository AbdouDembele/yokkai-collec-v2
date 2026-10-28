begin;

-- PostgreSQL needs SELECT as well as DELETE to identify rows targeted by the
-- admin category resynchronisation. RLS still limits access to administrators.
grant select on table public.card_categories to authenticated;

commit;
