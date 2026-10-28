begin;

-- These trigger helpers were created by supabase_admin in production. Execute
-- this migration as their owning migration role so grants made by that role can
-- be revoked; trigger execution itself does not require client EXECUTE rights.
revoke execute on function
  public.prevent_locked_card_transfer_or_delete(),
  public.prevent_locked_trade_offer()
from public, anon;

commit;
