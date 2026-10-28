begin;

alter table public.notifications
  drop constraint notifications_reference_id_fkey,
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('wishlist_card_on_auction','friend_request'));

create function public.notify_friend_request()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.notifications(user_id,type,reference_id)
  values(new.friend_id,'friend_request',new.id)
  on conflict do nothing;
  return new;
end; $$;
revoke all on function public.notify_friend_request() from public,anon,authenticated;

create trigger friendships_notify_recipient
  after insert on public.friendships for each row
  execute function public.notify_friend_request();

create or replace function public.list_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',n.id,'type',n.type,'referenceId',n.reference_id,'readAt',n.read_at,
      'createdAt',n.created_at,'cardName',c.nom,'actorPseudo',sender.pseudo
    ) order by n.created_at desc),'[]'::jsonb)
    from (select * from public.notifications where user_id=player_id order by created_at desc limit safe_limit) n
    left join public.auctions a on n.type='wishlist_card_on_auction' and a.id=n.reference_id
    left join public.user_cards uc on uc.id=a.card_instance_id
    left join public.cards c on c.id=uc.card_id
    left join public.friendships f on n.type='friend_request' and f.id=n.reference_id
    left join public.user_profiles sender on sender.user_id=f.user_id);
end; $$;

commit;
