begin;

create function public.discard_collection_cards(p_card_instance_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  requested_count integer;
  deleted_count integer;
  total_reward integer;
  balance integer;
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  requested_count := cardinality(p_card_instance_ids);
  if requested_count is null or requested_count = 0 then
    raise exception 'CARD_SELECTION_EMPTY' using errcode = 'P0001';
  end if;
  if requested_count > 2000 then
    raise exception 'CARD_SELECTION_TOO_LARGE' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_card_instance_ids) instance_id where instance_id is null)
    or (select count(distinct instance_id) from unnest(p_card_instance_ids) instance_id) <> requested_count then
    raise exception 'CARD_SELECTION_INVALID' using errcode = 'P0001';
  end if;

  with deleted as (
    delete from public.user_cards
    where user_id = player_id and id = any(p_card_instance_ids)
    returning rarity
  )
  select count(*)::integer,
    coalesce(sum(public.card_destruction_value(rarity)), 0)::integer
  into deleted_count, total_reward
  from deleted;

  -- Raising here rolls the whole function back: a stale or foreign ID can never
  -- cause a partial bulk destruction.
  if deleted_count <> requested_count then
    raise exception 'CARD_NOT_OWNED' using errcode = 'P0001';
  end if;

  update public.user_profiles
  set karas_balance = karas_balance + total_reward
  where user_id = player_id
  returning karas_balance into balance;
  if not found then
    raise exception 'PROFILE_MISSING' using errcode = 'P0001';
  end if;

  return balance;
end;
$$;

revoke all on function public.discard_collection_cards(uuid[]) from public, anon;
grant execute on function public.discard_collection_cards(uuid[]) to authenticated;

commit;
