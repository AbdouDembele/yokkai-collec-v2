-- Product rule (PhyesGG, 2026-11-06): a custom card image belongs to the player
-- who chose it. A card that changes owner shows the catalogue image again.
--
-- create_auction already cleared the image when a card was listed, but trades
-- (respond_trade_offer) and the admin recovery sanctions moved cards with the
-- previous owner's image. A BEFORE UPDATE trigger covers every ownership change,
-- current and future, instead of patching each function.
--
-- Existing cards are not modified: the database does not record who set an
-- image, so an image the current owner chose cannot be told apart from an
-- inherited one.
begin;
set local lock_timeout = '3s';

create or replace function public.clear_custom_image_on_owner_change()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    new.custom_image_url := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_custom_image_on_owner_change() from public, anon, authenticated, service_role;

create trigger user_cards_clear_custom_image_on_owner_change
  before update of user_id on public.user_cards
  for each row
  when (new.user_id is distinct from old.user_id)
  execute function public.clear_custom_image_on_owner_change();

commit;
