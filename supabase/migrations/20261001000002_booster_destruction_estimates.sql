begin;

create or replace function public.get_pack_destruction_values(p_instance_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare player_id uuid := auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (
    select coalesce(jsonb_object_agg(values_by_id.instance_id,values_by_id.reward),'{}'::jsonb)
    from (
      select owned.id::text as instance_id,public.card_destruction_value(owned.rarity) as reward
      from public.user_cards owned
      where owned.user_id=player_id and owned.id=any(p_instance_ids)
      union all
      select choices.id::text,public.card_destruction_value(choices.rarity)
      from public.decision_pack_choices choices
      join public.decision_packs packs on packs.id=choices.pack_id
      where packs.user_id=player_id and packs.status='pending' and not choices.is_discarded
        and choices.id=any(p_instance_ids)
    ) values_by_id
  );
end; $$;

create or replace function public.discard_regular_pack_card(p_card_instance_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare reward integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select public.card_destruction_value(owned.rarity) into reward
    from public.user_cards owned
    where owned.id=p_card_instance_id and owned.user_id=auth.uid()
    for update of owned;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  delete from public.user_cards where id=p_card_instance_id and user_id=auth.uid();
  perform public.credit_karas(auth.uid(),reward);
end; $$;

create or replace function public.discard_collection_card(p_card_instance_id uuid)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare player_id uuid:=auth.uid();discarded_rarity public.card_rarity;reward integer;balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  delete from public.user_cards where id=p_card_instance_id and user_id=player_id returning rarity into discarded_rarity;
  if not found then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  reward:=public.card_destruction_value(discarded_rarity);
  update public.user_profiles set karas_balance=karas_balance+reward where user_id=player_id returning karas_balance into balance;
  if not found then raise exception 'PROFILE_MISSING' using errcode='P0001'; end if;
  return balance;
end; $$;

create or replace function public.decision_pack_cards(p_pack_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',cards.id,'name',cards.nom,'category',cards.categorie,'anime',cards.franchise,
    'rarity',choices.rarity,'image',cards.image_url,'instanceId',choices.id,'obtainedAt',packs.created_at,
    'shiny',choices.is_shiny,'isEvolved',false,'discarded',choices.is_discarded,
    'destructionValue',public.card_destruction_value(choices.rarity)
  ) order by choices.rarity,choices.position),'[]'::jsonb)
  from public.decision_pack_choices choices
  join public.decision_packs packs on packs.id=choices.pack_id
  join public.cards cards on cards.id=choices.card_id
  where choices.pack_id=p_pack_id;
$$;

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
  perform public.credit_karas(player_id,reward);
  return jsonb_build_object('id',choice.card_id,'name',choice.nom,'category',choice.categorie,'anime',choice.franchise,
    'rarity',choice.rarity,'image',choice.image_url,'catalogueImage',choice.image_url,'customImageUrl',null,
    'instanceId',copy_id,'obtainedAt',kept_at,'shiny',choice.is_shiny,'isEvolved',false,
    'isFirstOwner',choice.rarity='LR','folderId',null,'karasReward',reward);
end; $$;

revoke all on function public.get_pack_destruction_values(uuid[]) from public,anon;
grant execute on function public.get_pack_destruction_values(uuid[]),public.discard_regular_pack_card(uuid),
  public.discard_collection_card(uuid),public.keep_decision_pack_card(uuid) to authenticated;

commit;
