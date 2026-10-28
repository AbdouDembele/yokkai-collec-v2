-- Completed achievements are permanent: avoid rescanning their collection.
begin;

create or replace function public.complete_achievements(p_user_id uuid, p_condition_types text[])
returns void language plpgsql volatile security definer set search_path=''
as $$
begin
  -- Materialize before evaluating progress: SQL predicate order is not guaranteed.
  with pending as materialized (
    select a.id,a.condition_type,a.condition_value from public.achievements a
    where a.condition_type=any(p_condition_types)
      and not exists (
        select 1 from public.user_achievements ua
        where ua.user_id=p_user_id and ua.achievement_id=a.id and ua.completed_at is not null
      )
  ), completed as (
    insert into public.user_achievements(user_id,achievement_id,completed_at)
    select p_user_id,a.id,clock_timestamp() from pending a
    where public.achievement_progress(p_user_id,a.condition_type)>=a.condition_value
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

commit;
