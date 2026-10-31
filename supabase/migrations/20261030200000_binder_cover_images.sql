begin;
set local lock_timeout='3s';

-- Catalogue artwork only; no custom player images, extra RPC or new privilege.
-- Reuse the filtered catalogue and select covers only for the bounded page.
do $covers$
declare target regprocedure; original text; changed text; mode text;
begin
  foreach mode in array array['stable','legacy'] loop
    target:=case when mode='stable'
      then 'public.get_binder_albums_page(uuid,text,text,boolean,integer,integer)'::regprocedure
      else 'public.get_panini_albums_page(text,text,integer,integer,boolean)'::regprocedure end;
    original:=replace(pg_get_functiondef(target),chr(13),'');
    if mode='stable' then
      changed:=replace(original,
        'select jsonb_build_object(''items'',coalesce((select jsonb_agg(jsonb_build_object(''binderKey'',binder_key,',
        ' , covers as materialized (
          select distinct on (l.binder_key) l.binder_key,c.image_url as image
          from catalogue l join page p using(binder_key) join public.cards c on c.id=l.card_id
          where nullif(btrim(c.image_url),'''') is not null
          order by l.binder_key,
            case c.rarete_base when ''LR'' then 0 when ''SSR'' then 1 when ''SR'' then 2 when ''R'' then 3 else 4 end,c.id
        )
        select jsonb_build_object(''items'',coalesce((select jsonb_agg(jsonb_build_object(''binderKey'',binder_key,
          ''image'',(select image from covers where covers.binder_key=page.binder_key),');
    else
      changed:=replace(original,
        'select jsonb_build_object(
      ''items'', coalesce(jsonb_agg(jsonb_build_object(',
        ' , covers as materialized (
          select distinct on (l.license) l.license,c.image_url as image
          from catalogue l join selected p using(license) join public.cards c on c.id=l.id
          where nullif(btrim(c.image_url),'''') is not null
          order by l.license,
            case c.rarete_base when ''LR'' then 0 when ''SSR'' then 1 when ''SR'' then 2 when ''R'' then 3 else 4 end,c.id
        )
        select jsonb_build_object(
      ''items'', coalesce(jsonb_agg(jsonb_build_object(
        ''image'',(select image from covers where covers.license=selected.license),');
    end if;
    if changed=original or changed not like '%covers as materialized%' then
      raise exception 'BINDER_COVER_PATCH_MISMATCH: %',target;
    end if;
    execute changed;
  end loop;
end $covers$;
notify pgrst,'reload schema';
commit;
