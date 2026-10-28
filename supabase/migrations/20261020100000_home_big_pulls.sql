begin;

-- No pack-origin column exists. First ownership excludes transferred copies;
-- evolved copies are also excluded, since evolution is not a pack opening.
-- Private profiles contribute catalogue cards, never identity or appearance.
create index user_cards_recent_original_pulls_idx
  on public.user_cards(date_obtention desc,id desc)
  where is_first_owner and not is_evolved and (rarity in ('SSR','LR') or is_shiny);

create function public.get_recent_big_pulls(p_limit int default 20)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from auth.users u join public.user_profiles p on p.user_id=u.id
    where u.id=viewer and (u.banned_until is null or u.banned_until<=now())
      and not exists(select 1 from public.account_deletion_log where user_id=viewer)) then
    raise exception 'AUTH_REQUIRED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'instanceId',pulled.id,'obtainedAt',pulled.date_obtention,
    'playerId',case when pulled.is_public then pulled.user_id else null end,
    'playerName',case when pulled.is_public then pulled.pseudo else null end,
    'avatarUrl',case when pulled.is_public then pulled.avatar_url else null end,
    'profileStyle',case when pulled.is_public then public.billing_profile_cosmetics(pulled.user_id) else null end,
    'card',jsonb_build_object('id',pulled.card_id,'name',pulled.nom,
      'category',pulled.categorie,'anime',pulled.franchise,'rarity',pulled.rarity,
      'image',pulled.image_url,'shiny',pulled.is_shiny)
    ) order by pulled.date_obtention desc,pulled.id desc),'[]'::jsonb) into result
  from (
    select uc.id,uc.date_obtention,uc.user_id,uc.card_id,uc.rarity,uc.is_shiny,
      p.pseudo,p.avatar_url,p.is_public,c.nom,c.categorie,c.franchise,c.image_url
    from public.user_cards uc
    join public.cards c on c.id=uc.card_id
    join public.user_profiles p on p.user_id=uc.user_id
    join auth.users u on u.id=uc.user_id
    where uc.is_first_owner and not uc.is_evolved and (uc.rarity in ('SSR','LR') or uc.is_shiny)
      and (u.banned_until is null or u.banned_until<=now())
      and not exists(select 1 from public.account_deletion_log where user_id=uc.user_id)
      and not public.users_blocked(viewer,uc.user_id)
    order by uc.date_obtention desc,uc.id desc
    limit greatest(1,least(coalesce(p_limit,20),50))
  ) pulled;
  return result;
end; $$;

revoke all on function public.get_recent_big_pulls(int) from public,anon,authenticated,service_role;
grant execute on function public.get_recent_big_pulls(int) to authenticated;
notify pgrst, 'reload schema';
commit;
