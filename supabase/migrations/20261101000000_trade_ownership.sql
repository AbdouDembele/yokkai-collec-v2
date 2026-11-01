begin;
set local lock_timeout='3s';

-- Ownership is separate from availability: locked/listed copies still belong
-- to the viewer. Only their compact variant counts are returned, never those
-- of the partner. Keep the existing friendship guard and tradable inventories.
create or replace function public.get_trade_context(p_friend_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); friend_name text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if public.friendship_state(player_id,p_friend_id)<>'accepted' then raise exception 'FRIENDS_ONLY' using errcode='P0001'; end if;
  select pseudo into friend_name from public.user_profiles where user_id=p_friend_id;
  return jsonb_build_object('friend',jsonb_build_object('id',p_friend_id,'pseudo',friend_name),
    'balance',(select karas_balance from public.user_profiles where user_id=player_id),
    'ownCards',public.trade_card_json(array(select id from public.user_cards where user_id=player_id and not is_locked
      and not exists(select 1 from public.auctions where card_instance_id=user_cards.id and status='active'))),
    'friendCards',public.trade_card_json(array(select id from public.user_cards where user_id=p_friend_id and not is_locked
      and not exists(select 1 from public.auctions where card_instance_id=user_cards.id and status='active'))),
    'ownedVariants',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',owned.card_id,'rarity',owned.rarete_base,'shiny',owned.is_shiny,
      'isEvolved',owned.is_evolved,'count',owned.copies)), '[]'::jsonb)
      from (select uc.card_id,c.rarete_base,uc.is_shiny,uc.is_evolved,count(*) as copies
        from public.user_cards uc join public.cards c on c.id=uc.card_id
        where uc.user_id=player_id
        group by uc.card_id,c.rarete_base,uc.is_shiny,uc.is_evolved) owned));
end;
$$;

-- CREATE OR REPLACE retains the existing authenticated-only EXECUTE grants.
commit;
