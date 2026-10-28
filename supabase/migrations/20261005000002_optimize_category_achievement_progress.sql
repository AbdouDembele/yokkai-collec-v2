-- Compute category ownership and catalogue totals in one aggregate.

begin;

create or replace function public.achievement_progress(p_user_id uuid, p_condition_type text)
returns integer language plpgsql stable security definer set search_path = ''
as $$
declare result integer;
begin
  result := case p_condition_type
    when 'regular_packs_opened' then (select regular_packs_opened from public.user_achievement_stats where user_id=p_user_id)
    when 'decision_packs_completed' then (select decision_packs_completed from public.user_achievement_stats where user_id=p_user_id)
    when 'auctions_won' then (select auctions_won from public.user_achievement_stats where user_id=p_user_id)
    when 'trades_completed' then (select trades_completed from public.user_achievement_stats where user_id=p_user_id)
    when 'ssr_evolved_to_lr' then (select ssr_evolved_to_lr from public.user_achievement_stats where user_id=p_user_id)
    when 'unique_cards_collected' then (select count(distinct card_id) from public.user_cards where user_id=p_user_id)
    when 'first_lr_card' then (select case when exists(
      select 1 from public.user_cards uc join public.cards c on c.id=uc.card_id
      where uc.user_id=p_user_id and c.rarete_base='LR'
    ) then 1 else 0 end)
    when 'shiny_cards_collected' then (select count(*) from public.user_cards where user_id=p_user_id and is_shiny)
    when 'cards_collected_category_percent' then (
      select coalesce(max(floor(100.0*owned/total)::integer),0) from (
        select c.categorie, count(distinct uc.card_id) as owned, count(distinct c.id) as total
        from public.cards c left join public.user_cards uc on uc.card_id=c.id and uc.user_id=p_user_id
        where c.categorie is not null
        group by c.categorie
      ) category_progress where total>0
    )
    else 0
  end;
  return coalesce(result,0);
end;
$$;

commit;
