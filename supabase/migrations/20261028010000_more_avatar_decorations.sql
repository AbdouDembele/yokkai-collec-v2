begin;

-- New decorations; legacy stored Laurel values remain readable but are no
-- longer offered or rendered by the client, which normalizes them to none.
do $migration$
declare definition text; previous text := $old$('none','orbit','crystal','bloom','flame','cat','royal','sakura','wings','electric','laurel')$old$;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'AVATAR_FRAME_CATALOG_CHANGED';
  end if;
  execute replace(definition,previous,$new$('none','orbit','crystal','bloom','flame','cat','royal','sakura','wings','electric','laurel','fox','roses','lunar','dragon','ocean','pixel')$new$);
end;
$migration$;
notify pgrst, 'reload schema';
commit;
