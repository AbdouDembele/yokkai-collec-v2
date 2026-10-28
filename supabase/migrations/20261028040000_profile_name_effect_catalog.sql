begin;

do $migration$
declare
  definition text;
  previous text := $old$('solid','gradient','neon','outline','pop','shimmer','prism')$old$;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  if (length(definition) - length(replace(definition, previous, ''))) / length(previous) <> 1 then
    raise exception 'PROFILE_NAME_EFFECT_CATALOG_CHANGED';
  end if;
  execute replace(definition, previous, $new$('solid','gradient','neon','outline','pop','shimmer','prism','aurora','chrome','fire','frost','hologram','glitch','pulse')$new$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
