begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The collection renders the live catalogue rarity. Copies acquired before a
-- catalogue correction retain their original stored rarity; that historical
-- value must not prevent currently-LR/SSR normal copies from evolving.
-- Keep catalogue checks, ownership, required counts, locks and auction guards.
do $patch$
declare
  original text;
  changed text;
  stale_predicate text;
  target_rarity text;
  target regprocedure;
begin
  foreach target_rarity in array array['SSR','LR'] loop
    target := format('public.evolve_%s_card(uuid[])',lower(target_rarity))::regprocedure;
    original := pg_get_functiondef(target);
    stale_predicate := format(' and owned.rarity=%L',target_rarity);
    if (length(original)-length(replace(original,stale_predicate,''))) / length(stale_predicate) <> 2
      or position(format('rarete_base=%L',target_rarity) in original)=0 then
      raise exception 'EVOLUTION_CATALOGUE_RARITY_PATCH_MISMATCH: %',target;
    end if;
    -- SSR historically implied "not evolved" through its rarity/Shiny flags.
    -- Make that fence explicit for previously-LR INFINITY copies reclassified SSR.
    changed := replace(original,stale_predicate,
      case when target_rarity='SSR' then ' and not owned.is_evolved' else '' end);
    execute changed;
  end loop;
end $patch$;

notify pgrst,'reload schema';
commit;
