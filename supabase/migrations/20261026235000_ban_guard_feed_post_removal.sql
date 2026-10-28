begin;
set local lock_timeout='3s';

-- 20261026210000 redefined delete_profile_wall_post after the #374 ban guard
-- was applied to it. Restore the guard the same way, only if it is missing, so
-- databases that applied both migrations in either order converge.
do $guard$
declare
  fn record;
begin
  select p.prosrc, pg_get_functiondef(p.oid) as def into fn
  from pg_proc p where p.oid='public.delete_profile_wall_post(uuid)'::regprocedure;
  if fn.prosrc ~* '^\s*begin\s+perform\s+public\.assert_player_not_banned\(\)\s*;' then
    return;
  end if;
  if array_length(string_to_array(fn.def, fn.prosrc), 1)<>2 then
    raise exception 'Cannot guard public.delete_profile_wall_post(uuid)';
  end if;
  execute replace(fn.def, fn.prosrc, E'\nbegin\n  perform public.assert_player_not_banned();\n'
    || regexp_replace(fn.prosrc, ';?\s*$', '') || E';\nend\n');
end $guard$;

commit;
