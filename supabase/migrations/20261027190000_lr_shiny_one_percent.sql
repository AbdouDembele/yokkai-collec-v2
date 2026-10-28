begin;

-- Owner-approved product change: every newly drawn LR has a 1% Shiny chance.
-- Preserve the live pack functions, their guards, quotas and rarity weights.
-- Existing cards and pending Decision choices retain their original results.
do $migration$
declare
  routine text;
  definition text;
  previous text;
  replacement text;
begin
  foreach routine in array array[
    'public.open_regular_pack()',
    'public.open_decision_pack()',
    'public.get_game_info()'
  ] loop
    definition := pg_get_functiondef(routine::regprocedure);
    if routine = 'public.get_game_info()' then
      previous := $old$'shinyRate', 10$old$;
      replacement := $new$'shinyRate', 1$new$;
    else
      previous := $old$shiny:=selected_card.rarete_base='LR' and random()<.1;$old$;
      replacement := $new$shiny:=selected_card.rarete_base='LR' and random()<.01;$new$;
    end if;
    if (length(definition) - length(replace(definition, previous, ''))) / length(previous) <> 1 then
      raise exception 'SHINY_RATE_DEFINITION_CHANGED: %', routine;
    end if;
    execute replace(definition, previous, replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
