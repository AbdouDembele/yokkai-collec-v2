-- Custom card art is saved by the server only (PhyesGG, 2026-11-06).
--
-- The site route /api/collection/custom-image verifies the player's session,
-- checks the file weight (8 MB max, the MP4 for Imgur GIFs) and then calls
-- set_card_custom_image_for_player with the service role. Players can no
-- longer call set_card_custom_image directly, so the weight check cannot be
-- skipped. Same rules as before: allowed hosts, ownership, Pro required to set
-- a new image, removing an image always allowed, banned accounts refused.
begin;
set local lock_timeout = '3s';

create or replace function public.set_card_custom_image_for_player(
  p_player uuid,
  p_card_instance_id uuid,
  p_image_url text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  image text := nullif(btrim(p_image_url), '');
  previous text;
  result jsonb;
begin
  if p_player is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.assert_player_not_banned(p_player);
  if image is not null and (char_length(image) > 2048 or image !~* '^https://((i[.])?imgur[.]com|i[.]pinimg[.]com)/[^[:space:]]+$') then
    raise exception 'INVALID_IMGUR_URL';
  end if;
  select custom_image_url into previous
  from public.user_cards
  where id = p_card_instance_id and user_id = p_player
  for update;
  if not found then raise exception 'CARD_NOT_OWNED'; end if;
  if image is not null and image is distinct from previous and not public.billing_has_game_pro(p_player) then
    raise exception 'PRO_REQUIRED';
  end if;
  update public.user_cards set custom_image_url = image where id = p_card_instance_id;
  select public.profile_card_json(c, uc) into result
  from public.user_cards uc join public.cards c on c.id = uc.card_id
  where uc.id = p_card_instance_id;
  return result;
end;
$$;

revoke all on function public.set_card_custom_image_for_player(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_card_custom_image_for_player(uuid, uuid, text) to service_role;

-- The player-callable version is closed. Kept (owner only) so older migrations
-- and rollbacks still resolve it.
revoke all on function public.set_card_custom_image(uuid, text) from public, anon, authenticated, service_role;

commit;
