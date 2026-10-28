begin;

revoke execute on function
  public.on_profile_create_achievement_stats(),
  public.on_card_acquired_achievements(),
  public.on_decision_pack_completed_achievement(),
  public.on_auction_won_achievement(),
  public.on_trade_completed_achievement()
from public, anon, authenticated;

commit;
