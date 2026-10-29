-- Apply only after coordinating SQL access. Leaves the migration registry intact.
-- Restore the prior function body; CREATE OR REPLACE preserves existing ACLs.
begin;
CREATE OR REPLACE FUNCTION public.get_profile_details(p_identifier text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare base jsonb; target uuid; allowed boolean; result jsonb;
begin
  base := public.get_profile(p_identifier);
  target := (base->>'id')::uuid;
  allowed := (base->>'canViewCollection')::boolean;
  select jsonb_build_object(
    'joinedAt', (select to_jsonb(u)->>'created_at' from auth.users u where u.id = target),
    'interests', (select interests from public.user_profiles where user_id = target),
    'widgets', (select profile_widgets from public.user_profiles where user_id = target),
    'bannerUrl', (select banner_url from public.user_profiles where user_id = target),
    'bannerFrame', (select case when banner_frame_source = coalesce(banner_url,banner_card_id::text)
      and not exists(select 1 from public.user_blocks where (blocker_id=auth.uid() and blocked_id=target) or (blocked_id=auth.uid() and blocker_id=target))
      then banner_frame else null end from public.user_profiles where user_id = target),
    'widgetCategories', coalesce((select jsonb_agg(category order by category) from
      (select distinct upper(btrim(categorie)) category from public.cards where btrim(categorie) <> '') categories), '[]'::jsonb),
    'boostersOpened', case when allowed then
      coalesce((select regular_packs_opened from public.user_achievement_stats where user_id = target), 0)
      + greatest(0,(select count(*) from public.decision_packs where user_id = target)
        - coalesce((select profile_decision_packs_offset from public.user_achievement_stats where user_id = target),0)) else null end,
    'lrCount', case when allowed then (select count(*) from public.user_cards where user_id = target and rarity = 'LR') else null end,
    'ssrCount', case when allowed then (select count(*) from public.user_cards where user_id = target and rarity = 'SSR') else null end,
    'mutualFriends', case when (base->>'friendsVisible')::boolean then coalesce((
      select jsonb_agg(friend) from jsonb_array_elements(base->'friends') friend
      where exists(select 1 from public.friendships f where f.status = 'accepted'
        and ((f.user_id = auth.uid() and f.friend_id = (friend->>'id')::uuid)
          or (f.friend_id = auth.uid() and f.user_id = (friend->>'id')::uuid)))
    ), '[]'::jsonb) else '[]'::jsonb end,
    'favoriteAlbums', case when allowed then coalesce((
      select jsonb_agg(album order by album->>'license') from (
        select jsonb_build_object('license', f.license, 'total', count(distinct c.id),
          'owned', count(distinct owned.card_id),
          'percent', round(100.0 * count(distinct owned.card_id) / nullif(count(distinct c.id),0))) album
        from public.panini_album_favorites f
        join public.card_franchises links on links.franchise = f.license
        join public.cards c on c.id = links.card_id
        left join (select distinct card_id from public.user_cards where user_id = target) owned on owned.card_id = c.id
        where f.user_id = target group by f.license
      ) albums
    ), '[]'::jsonb) else '[]'::jsonb end,
    'activity', case when allowed then coalesce((
      select jsonb_agg(entry order by happened_at desc, event_id) from (
        select * from (
          select uc.date_obtention happened_at, uc.id::text event_id,
            jsonb_build_object('id', uc.id, 'kind', 'obtained', 'at', uc.date_obtention,
              'card', public.profile_card_json(c,uc)) entry
          from public.user_cards uc join public.cards c on c.id = uc.card_id
          where uc.user_id = target and not exists(select 1 from public.auctions a
            where a.status = 'sold' and a.buyer_id = target and a.card_instance_id = uc.id
              and a.ends_at <= uc.date_obtention and a.ends_at > uc.date_obtention - interval '5 minutes')
          order by uc.date_obtention desc, uc.id limit 20
        ) acquisitions
        union all
        select * from (
          select a.ends_at happened_at, a.id::text event_id,
            jsonb_build_object('id', a.id, 'kind', case when a.seller_id = target then 'sold' else 'bought' end,
              'at', a.ends_at, 'price', a.current_price, 'card', case when c.id is not null then
                jsonb_build_object('id', c.id, 'name', c.nom, 'category', c.categorie,
                  'anime', c.franchise, 'rarity', c.rarete_base, 'image', c.image_url) else a.card_snapshot end) entry
          from public.auctions a left join public.user_cards uc on uc.id = a.card_instance_id
          left join public.cards c on c.id = uc.card_id
          where a.status = 'sold' and (a.seller_id = target or a.buyer_id = target)
            and (c.id is not null or a.card_snapshot is not null)
          order by a.ends_at desc, a.id limit 20
        ) sales
        order by happened_at desc, event_id limit 20
      ) recent
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end; $function$

;
commit;
