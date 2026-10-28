-- Presentation rollback only. Keep every catalogue row, source link, collection,
-- proof, new preference and historical favorite/widget. No table is dropped.
begin;
update public.anime_series_settings set enabled=false where singleton;
commit;
