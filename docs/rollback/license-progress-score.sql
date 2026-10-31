begin;
set local lock_timeout='3s';
-- Restore the previous application first. Keep all rank observations locked in place.
do $rollback$
declare original text; changed text;
begin
 original:=pg_get_functiondef('public.get_license_leaderboard(text,integer,integer,text,boolean)'::regprocedure);
 changed:=regexp_replace(original,'  -- BEGIN PROGRESS_SCORE_V2.*?  -- END PROGRESS_SCORE_V2[[:space:]]*','','s');
 if changed=original then raise exception 'PROGRESS_SCORE_ROLLBACK_MISMATCH'; end if;
 execute changed;
end $rollback$;
notify pgrst,'reload schema';
commit;
