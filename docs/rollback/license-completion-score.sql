begin;
set local lock_timeout='3s';
do $rollback$
declare original text; changed text;
begin
  original:=pg_get_functiondef('public.get_license_leaderboard(text,integer,integer,text,boolean)'::regprocedure);
  changed:=regexp_replace(original,'  -- BEGIN COMPLETION_SCORE_V1.*?  -- END COMPLETION_SCORE_V1' || chr(10),'','s');
  if changed=original then raise exception 'COMPLETION_SCORE_ROLLBACK_MISMATCH'; end if;
  execute changed;
end $rollback$;
-- Leave observations under their isolated score-v1 key for recovery.
notify pgrst,'reload schema';
commit;
