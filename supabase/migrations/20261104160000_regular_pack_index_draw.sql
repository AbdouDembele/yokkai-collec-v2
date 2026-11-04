-- Performance: each Regular pack draws 5 cards with "order by id offset N"
-- over the cards of the drawn rarity. The plan fetched every skipped row from
-- the table (up to about 60 000 Commons, about 35 ms per draw). The offset now
-- walks the (rarete_base, id) index only and the card row is read once by id.
-- Same random() calls in the same order, same ordering and same offset, so
-- the same card for the same roll: drop rates, shiny odds, boost and pack
-- contents are unchanged. Only this statement of open_regular_pack() changes.
begin;
set local lock_timeout = '3s';
do $patch$
declare original text; changed text;
begin
  original := pg_get_functiondef('public.open_regular_pack()'::regprocedure);
  changed := replace(original,
    E'select * into selected_card from public.cards where rarete_base=rarities[rarity_index]\n      order by id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1;',
    E'select * into selected_card from public.cards where id=(\n      select pool.id from public.cards pool where pool.rarete_base=rarities[rarity_index]\n      order by pool.id offset floor(random()*pool_sizes[rarity_index])::bigint limit 1);');
  if changed = original then
    raise exception 'REGULAR_PACK_DRAW_PATCH_MISMATCH';
  end if;
  execute changed;
end
$patch$;
commit;
