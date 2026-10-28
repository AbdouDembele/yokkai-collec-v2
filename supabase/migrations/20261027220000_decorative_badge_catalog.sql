begin;

-- Extend the cosmetic badge catalogue while preserving membership and validation.
do $migration$
declare definition text; previous text := $old$('comet','bloom','crystal','orbit','flame','moon')$old$;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'BADGE_CATALOG_DEFINITION_CHANGED';
  end if;
  execute replace(definition,previous,$new$('comet','bloom','crystal','orbit','flame','moon','crown','bolt','heart','swords','gamepad','cat','ghost','butterfly')$new$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
