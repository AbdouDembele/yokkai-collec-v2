begin;

-- Optional showcase glow color; retain all existing Pro and style validation.
do $migration$
declare definition text; previous text; replacement text;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  previous := $old$'showcaseEffect','backgroundUrl'$old$;
  replacement := $new$'showcaseEffect','showcaseColor','backgroundUrl'$new$;
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'SHOWCASE_COLOR_KEYS_CHANGED';
  end if;
  definition := replace(definition,previous,replacement);
  previous := $old$array['color','secondary']$old$;
  replacement := $new$array['color','secondary','showcaseColor']$new$;
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'SHOWCASE_COLOR_VALIDATION_CHANGED';
  end if;
  execute replace(definition,previous,replacement);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
