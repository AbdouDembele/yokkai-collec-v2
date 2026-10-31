begin;
set local lock_timeout='3s';
-- Preserve both previous global modes and per-license reads. The unified mode
-- ranks by completed licenses, then distinct cards; identical pairs share a rank.
do $patch$
declare original text; changed text;
begin
  original:=pg_get_functiondef('public.get_license_leaderboard(text,integer,integer,text,boolean)'::regprocedure);
  changed:=replace(original,
    'if chosen in (''global:completed'',''global:cards'',''global:completed:legacy'',''global:cards:legacy'') then',
    'if chosen in (''global:overall'',''global:overall:legacy'',''global:completed'',''global:cards'',''global:completed:legacy'',''global:cards:legacy'') then');
  changed:=replace(changed,
    'case when chosen like ''global:completed%'' then coalesce(c.completed_licenses,0)',
    'case when chosen like ''global:completed%'' or chosen like ''global:overall%'' then coalesce(c.completed_licenses,0)');
  changed:=replace(changed,
    'select counts.*,rank() over(order by value desc) position,' || chr(10) || '        row_number() over(order by value desc,distinct_cards desc,lower(pseudo),user_id) global_order',
    'select counts.*,rank() over(order by value desc,case when chosen like ''global:overall%'' then distinct_cards else 0 end desc) position,' || chr(10) || '        row_number() over(order by value desc,distinct_cards desc,lower(pseudo),user_id) global_order');
  changed:=replace(changed,
    '''metric'',case when chosen like ''global:completed%'' then ''completed'' else ''cards'' end',
    '''metric'',case when chosen like ''global:overall%'' then ''overall'' when chosen like ''global:completed%'' then ''completed'' else ''cards'' end');
  if changed=original or changed not like '%global:overall%' or changed not like '%then distinct_cards else 0%' or changed not like '%then ''overall''%' then
    raise exception 'GLOBAL_RANK_PATCH_MISMATCH';
  end if;
  execute changed;
end $patch$;
notify pgrst,'reload schema';
commit;
