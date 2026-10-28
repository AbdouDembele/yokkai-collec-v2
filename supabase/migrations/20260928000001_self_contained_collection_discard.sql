begin;

-- Keep this RPC self-contained for installations whose older discard
-- migrations were not applied. Deletion, reward and returned balance remain
-- one atomic operation.
create or replace function public.discard_collection_card(p_card_instance_id uuid)
returns integer language plpgsql volatile security definer set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  discarded_rarity public.card_rarity;
  reward integer;
  balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;

  delete from public.user_cards
    where id = p_card_instance_id and user_id = player_id
    returning rarity into discarded_rarity;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode = 'P0001'; end if;

  reward := case discarded_rarity
    when 'C' then 1 when 'R' then 2 when 'SR' then 3 when 'SSR' then 4 when 'LR' then 5
  end;
  update public.user_profiles
    set karas_balance = karas_balance + reward
    where user_id = player_id
    returning karas_balance into balance;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;

  return balance;
end;
$$;

revoke all on function public.discard_collection_card(uuid) from public, anon;
grant execute on function public.discard_collection_card(uuid) to authenticated;

commit;
