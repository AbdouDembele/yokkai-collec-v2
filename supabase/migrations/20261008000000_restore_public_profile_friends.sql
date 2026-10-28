begin;

create or replace function public.get_profile(p_identifier text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); target public.user_profiles%rowtype; result jsonb; allowed boolean; friends_allowed boolean;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_identifier is null or btrim(p_identifier)='' then
    select * into target from public.user_profiles where user_id=viewer;
  else
    select * into target from public.user_profiles where lower(pseudo)=lower(btrim(p_identifier))
      or user_id=case when p_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_identifier::uuid else null end limit 1;
  end if;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  allowed:=public.can_view_collection(viewer,target.user_id);
  friends_allowed:=viewer=target.user_id or target.is_public;
  select jsonb_build_object(
    'id',target.user_id,'pseudo',target.pseudo,'avatarUrl',target.avatar_url,'bio',target.bio,
    'isPublic',target.is_public,'canViewCollection',allowed,
    'bannerCard',(select jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,'rarity',c.rarete_base,'image',c.image_url) from public.cards c where c.id=target.banner_card_id),
    'friendshipStatus',case when target.user_id=viewer then 'self' else public.friendship_state(viewer,target.user_id) end,
    'featuredCards',case when allowed then coalesce((select jsonb_agg(public.profile_card_json(c,uc) order by pos)
      from unnest(target.featured_card_ids) with ordinality picked(instance_id,pos)
      join public.user_cards uc on uc.id=picked.instance_id and uc.user_id=target.user_id
      join public.cards c on c.id=uc.card_id),'[]'::jsonb) else '[]'::jsonb end,
    'friendsVisible',friends_allowed,
    'friends',case when friends_allowed then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url) order by lower(p.pseudo))
      from public.friendships f join public.user_profiles p on p.user_id=case when f.user_id=target.user_id then f.friend_id else f.user_id end
      where f.status='accepted' and (f.user_id=target.user_id or f.friend_id=target.user_id)),'[]'::jsonb) else '[]'::jsonb end,
    'cardCount',case when allowed then (select count(*) from public.user_cards where user_id=target.user_id) else null end,
    'distinctCardCount',case when allowed then (select count(distinct card_id) from public.user_cards where user_id=target.user_id) else null end
  ) into result;
  return result;
end; $$;

commit;
