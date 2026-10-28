begin;

do $migration$
declare
  definition text;
  previous text := $old$('modern','classic','rounded','mono','bold','editorial','script','display')$old$;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  if (length(definition) - length(replace(definition, previous, ''))) / length(previous) <> 1 then
    raise exception 'PROFILE_FONT_CATALOG_CHANGED';
  end if;
  execute replace(definition, previous, $new$('modern','classic','rounded','mono','bold','editorial','script','display','arcade','comic','gothic','signature','retro','tech','condensed','stencil')$new$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
