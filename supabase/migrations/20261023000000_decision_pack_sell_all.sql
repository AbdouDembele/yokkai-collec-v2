begin;

create function public.discard_decision_pack()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  target_pack uuid;
  reward integer;
  completed_at timestamptz := clock_timestamp();
begin
  if player_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select packs.id into target_pack
  from public.decision_packs as packs
  where packs.user_id = player_id and packs.status = 'pending'
  for update;

  if not found then
    raise exception 'DECISION_PACK_NOT_PENDING' using errcode = 'P0001';
  end if;

  select coalesce(sum(public.card_destruction_value(choices.rarity)), 0)::integer
  into reward
  from public.decision_pack_choices as choices
  where choices.pack_id = target_pack and not choices.is_discarded;

  if reward <= 0 then
    raise exception 'DECISION_PACK_NOT_PENDING' using errcode = 'P0001';
  end if;

  update public.decision_pack_choices
  set is_discarded = true
  where pack_id = target_pack and not is_discarded;

  update public.decision_packs
  set status = 'claimed', claimed_at = completed_at, kept_choice_id = null
  where id = target_pack;

  perform public.credit_karas(player_id, reward);
  return reward;
end;
$$;

revoke all on function public.discard_decision_pack()
from public, anon, authenticated;
grant execute on function public.discard_decision_pack() to authenticated;

commit;
