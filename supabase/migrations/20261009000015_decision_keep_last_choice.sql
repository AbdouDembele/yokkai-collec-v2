-- The other choices were already credited when discarded. Keeping the last
-- choice legitimately rewards zero; keep credit_karas validation unchanged.
begin;

create or replace function public.keep_decision_pack_card(p_choice_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare player_id uuid:=auth.uid();choice record;copy_id uuid;kept_at timestamptz:=clock_timestamp();reward integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select choices.*,cards.nom,cards.categorie,cards.franchise,cards.image_url into choice
    from public.decision_pack_choices choices
    join public.decision_packs packs on packs.id=choices.pack_id
    join public.cards cards on cards.id=choices.card_id
    where choices.id=p_choice_id and packs.user_id=player_id and packs.status='pending'
    for update of packs,choices;
  if not found or choice.is_discarded then raise exception 'DECISION_CHOICE_UNAVAILABLE' using errcode='P0001'; end if;
  select coalesce(sum(public.card_destruction_value(other_choices.rarity)),0)::integer into reward
    from public.decision_pack_choices other_choices
    where other_choices.pack_id=choice.pack_id and other_choices.id<>choice.id and not other_choices.is_discarded;
  insert into public.user_cards(user_id,card_id,date_obtention,rarity,is_shiny,is_evolved,is_first_owner)
    values(player_id,choice.card_id,kept_at,choice.rarity,choice.is_shiny,false,choice.rarity='LR') returning id into copy_id;
  update public.decision_pack_choices set is_discarded=true where pack_id=choice.pack_id and id<>choice.id and not is_discarded;
  update public.decision_packs set status='claimed',claimed_at=kept_at,kept_choice_id=choice.id where id=choice.pack_id;
  if reward <> 0 then
    perform public.credit_karas(player_id,reward);
  end if;
  return jsonb_build_object('id',choice.card_id,'name',choice.nom,'category',choice.categorie,'anime',choice.franchise,
    'rarity',choice.rarity,'image',choice.image_url,'catalogueImage',choice.image_url,'customImageUrl',null,
    'instanceId',copy_id,'obtainedAt',kept_at,'shiny',choice.is_shiny,'isEvolved',false,
    'isFirstOwner',choice.rarity='LR','folderId',null,'karasReward',reward);
end; $$;

commit;
