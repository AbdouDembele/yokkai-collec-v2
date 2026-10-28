-- LOCAL REHEARSAL rollback. Does not restore or delete any source/player data.
begin;
update public.anime_series_settings set enabled=false where singleton;
commit;
