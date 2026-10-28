begin;

-- Destroying a card rewards its owner according to its rarity:
-- C = 1, R = 2, SR = 3, SSR = 4 and LR = 5 Karas.
create or replace function public.discard_regular_pack_card(p_card_instance_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  discarded_rarity public.card_rarity;
  reward integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  delete from public.user_cards
    where id = p_card_instance_id and user_id = auth.uid()
    returning rarity into discarded_rarity;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode = 'P0001'; end if;
  reward := case discarded_rarity
    when 'C' then 1 when 'R' then 2 when 'SR' then 3 when 'SSR' then 4 when 'LR' then 5
  end;
  perform public.credit_karas(auth.uid(), reward);
end;
$$;

create or replace function public.discard_decision_pack_card(p_choice_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  target_pack uuid;
  discarded_rarity public.card_rarity;
  remaining integer;
  reward integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select choices.pack_id, choices.rarity into target_pack, discarded_rarity
    from public.decision_pack_choices as choices
    join public.decision_packs as packs on packs.id = choices.pack_id
    where choices.id = p_choice_id and packs.user_id = auth.uid()
      and packs.status = 'pending' and not choices.is_discarded
    for update of packs, choices;
  if not found then raise exception 'DECISION_CHOICE_UNAVAILABLE' using errcode = 'P0001'; end if;
  select count(*) into remaining from public.decision_pack_choices
    where pack_id = target_pack and not is_discarded;
  if remaining <= 1 then raise exception 'DECISION_LAST_CHOICE' using errcode = 'P0001'; end if;
  update public.decision_pack_choices set is_discarded = true where id = p_choice_id;
  reward := case discarded_rarity
    when 'C' then 1 when 'R' then 2 when 'SR' then 3 when 'SSR' then 4 when 'LR' then 5
  end;
  perform public.credit_karas(auth.uid(), reward);
end;
$$;

commit;
