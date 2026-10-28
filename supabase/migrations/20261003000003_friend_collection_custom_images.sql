begin;

create or replace function public.get_friend_collection(p_friend_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if public.friendship_state(player_id,p_friend_id)<>'accepted' then
    raise exception 'FRIENDS_ONLY' using errcode='P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'instanceId',uc.id,'id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
    'rarity',c.rarete_base,'image',coalesce(uc.custom_image_url,c.image_url),'catalogueImage',c.image_url,
    'customImageUrl',uc.custom_image_url,
    'obtainedAt',uc.date_obtention,'shiny',uc.is_shiny,'isEvolved',uc.is_evolved,
    'isFirstOwner',uc.is_first_owner,'folderId',null
  ) order by uc.date_obtention desc,uc.id),'[]'::jsonb)
  from public.user_cards uc join public.cards c on c.id=uc.card_id
  where uc.user_id=p_friend_id);
end; $$;

revoke all on function public.get_friend_collection(uuid) from public,anon,authenticated;
grant execute on function public.get_friend_collection(uuid) to authenticated;

commit;
