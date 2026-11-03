-- Avoid serializing two full copies of all collection variants. Let the
-- planner pipeline scores into totals and push the viewer filter into breakdown.
-- No score, visibility rule, grant, function signature or memory setting changes.
begin;
set local lock_timeout='3s';
do $patch$
declare original text; changed text;
begin
  original:=pg_get_functiondef('public.leaderboard_collection_without_styles(integer,integer,text,boolean)'::regprocedure);
  changed:=replace(replace(original,'variants as materialized (','variants as not materialized ('),
    'scored as materialized (','scored as not materialized (');
  if changed=original or strpos(changed,'variants as not materialized (')=0
    or strpos(changed,'scored as not materialized (')=0 then
    raise exception 'LEADERBOARD_PERFORMANCE_PATCH_MISMATCH';
  end if;
  execute changed;
end $patch$;
notify pgrst,'reload schema';
commit;
