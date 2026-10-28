begin;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('wishlist_card_on_auction','friend_request','outbid','trade_offer_received','auction_won','achievement_completed'));
alter table public.notifications alter column reference_id drop not null;
alter table public.notifications add column achievement_id text references public.achievements(id) on delete cascade;
alter table public.notifications add constraint notifications_reference_required
  check ((type='achievement_completed' and achievement_id is not null and reference_id is null)
    or (type<>'achievement_completed' and reference_id is not null and achievement_id is null));
alter table public.notifications add constraint notifications_user_type_achievement_key
  unique(user_id,type,achievement_id);

create or replace function public.complete_achievements(p_user_id uuid, p_condition_types text[])
returns void language plpgsql volatile security definer set search_path=''
as $$
begin
  with completed as (
    insert into public.user_achievements(user_id,achievement_id,completed_at)
    select p_user_id,a.id,clock_timestamp() from public.achievements a
    where a.condition_type=any(p_condition_types)
      and public.achievement_progress(p_user_id,a.condition_type)>=a.condition_value
    on conflict (user_id,achievement_id) do update
      set completed_at=excluded.completed_at
      where public.user_achievements.completed_at is null
    returning achievement_id
  )
  insert into public.notifications(user_id,type,reference_id,achievement_id)
    select p_user_id,'achievement_completed',null,achievement_id from completed
    on conflict do nothing;
end;
$$;

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',coalesce(n.reference_id::text,n.achievement_id),'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'achievementName',achievement.titre,
      'actorPseudo',coalesce(friend_sender.pseudo,trade_sender.pseudo)
    ) order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id order by created_at desc limit safe_limit) n
    left join public.auctions a on n.type in ('wishlist_card_on_auction','outbid','auction_won') and a.id=n.reference_id
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.friendships f on n.type='friend_request' and f.id=n.reference_id
    left join public.user_profiles friend_sender on friend_sender.user_id=f.user_id
    left join public.trade_offers trade on n.type='trade_offer_received' and trade.id=n.reference_id
    left join public.user_profiles trade_sender on trade_sender.user_id=trade.from_user
    left join public.achievements achievement on achievement.id=n.achievement_id);
end; $$;

commit;
