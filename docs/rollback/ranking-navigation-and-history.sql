begin;
set local lock_timeout='3s';
do $rollback$
declare signature text; original text; changed text; expression text;
begin
  foreach signature in array array[
    'public.get_collection_leaderboard(integer,integer,text,boolean)',
    'public.get_profile_likes_leaderboard(integer,integer,text,boolean)',
    'public.get_license_leaderboard(text,integer,integer,text,boolean)'
  ] loop
    original:=pg_get_functiondef(signature::regprocedure);
    expression:=case when signature like '%get_collection_%' then '''collection'''
      when signature like '%get_profile_%' then '''likes''' else '''licenses:'' || chosen' end;
    changed:=replace(original,'result := public.with_leaderboard_history(result,'||expression||'); return result','return result');
    if changed=original then raise exception 'RANK_HISTORY_ROLLBACK_MISMATCH'; end if;
    execute changed;
  end loop;
end $rollback$;
drop function public.with_leaderboard_history(jsonb,text);
drop function public.get_ranking_license_choices(text,text,text,boolean,integer,integer);
-- Observed ranks remain inaccessible to all API roles; keep them for recovery.
notify pgrst,'reload schema';
commit;
