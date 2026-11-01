begin;
set local lock_timeout = '3s';

-- Count only the authenticated viewer's copies of variants on the bounded page.
-- Locked and listed copies still belong to that viewer. No owner identities,
-- new API, grants or full collection payload are exposed.
do $migration$
declare
  target regprocedure := 'public.browse_auctions_page(integer,text,text,text,text,text)'::regprocedure;
  definition text;
  previous text;
  replacement text;
begin
  definition := replace(pg_get_functiondef(target), chr(13), '');
  for previous, replacement in select * from (values
    ($old$c.image_url,uc.is_shiny,$old$,
     $new$c.image_url,uc.is_shiny,uc.is_evolved,$new$),
    ($old$), page as (select * from limited order by watched_first desc,sort_key,tie_key,id limit p_limit)$old$,
     $new$), page as materialized (select * from limited order by watched_first desc,sort_key,tie_key,id limit p_limit),
     page_variants as materialized (
       select distinct coalesce(card_id,(card_snapshot->>'id')::uuid) card_id,
         coalesce(is_shiny,(card_snapshot->>'shiny')::boolean,false) is_shiny,
         coalesce(is_evolved,(card_snapshot->>'isEvolved')::boolean,false) is_evolved
       from page
     ), owned_variants as materialized (
       select uc.card_id,uc.is_shiny,uc.is_evolved,count(*) copies
       from page_variants v join public.user_cards uc
         on uc.user_id=player_id and uc.card_id=v.card_id
         and uc.is_shiny=v.is_shiny and uc.is_evolved=v.is_evolved
       group by uc.card_id,uc.is_shiny,uc.is_evolved
     )$new$),
    ($old$'shiny',a.is_shiny) else$old$,
     $new$'shiny',a.is_shiny,'isEvolved',a.is_evolved) else$new$),
    ($old$'sellerAvatarUrl',a.avatar_url,'buyerId',a.buyer_id,$old$,
     $new$'sellerAvatarUrl',a.avatar_url,'buyerId',a.buyer_id,'ownedCount',coalesce(owned.copies,0),$new$),
    ($old$from page a),'[]'::jsonb)$old$,
     $new$from page a left join owned_variants owned
       on owned.card_id=coalesce(a.card_id,(a.card_snapshot->>'id')::uuid)
       and owned.is_shiny=coalesce(a.is_shiny,(a.card_snapshot->>'shiny')::boolean,false)
       and owned.is_evolved=coalesce(a.is_evolved,(a.card_snapshot->>'isEvolved')::boolean,false)
     ),'[]'::jsonb)$new$)
  ) edits(previous,replacement) loop
    if array_length(string_to_array(definition,previous),1) <> 2 then
      raise exception 'MARKET_OWNERSHIP_DEFINITION_CHANGED';
    end if;
    definition := replace(definition,previous,replacement);
  end loop;
  execute definition;
end $migration$;

-- CREATE OR REPLACE preserves the existing authenticated-only ACL and filters.
notify pgrst, 'reload schema';
commit;
