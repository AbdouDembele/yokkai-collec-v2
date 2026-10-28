begin;

-- Extend avatar decorations without changing membership, ownership or rate limits.
do $migration$
declare definition text; previous text := $old$('none','orbit','crystal','bloom','flame')$old$;
begin
  definition := pg_get_functiondef('public.guard_pro_profile_style()'::regprocedure);
  if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
    raise exception 'AVATAR_FRAME_CATALOG_CHANGED';
  end if;
  execute replace(definition,previous,$new$('none','orbit','crystal','bloom','flame','cat','royal','sakura','wings','electric','laurel')$new$);
end;
$migration$;
notify pgrst, 'reload schema';
commit;
