begin;

-- Keep the bounded admin reader aligned with every event offered by the UI.
create or replace function public.admin_list_anticheat_events(
  p_user_id uuid default null,p_event_type text default '',p_limit integer default 50,p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_player_not_banned();
  if not public.is_current_user_admin() then raise exception 'ADMIN_REQUIRED' using errcode='P0001'; end if;
  p_event_type:=lower(btrim(coalesce(p_event_type,'')));
  if p_event_type not in (
    '','account_registered','trade_created','trade_accepted','trade_declined','trade_cancelled',
    'auction_created','auction_bid','auction_sold','auction_expired','referral_rewarded',
    'network_identity_shared','trade_shared_network_identity'
  ) then raise exception 'INVALID_ANTICHEAT_EVENT'; end if;
  p_limit:=least(greatest(coalesce(p_limit,50),1),100);
  p_offset:=greatest(coalesce(p_offset,0),0);
  with filtered as materialized (
    select e.*,coalesce(ap.pseudo,'Deleted player') actor_pseudo,
      coalesce(cp.pseudo,'Deleted player') counterparty_pseudo
    from public.anticheat_events e
    left join public.user_profiles ap on ap.user_id=e.actor_user_id
    left join public.user_profiles cp on cp.user_id=e.counterparty_user_id
    where (p_event_type='' or e.event_type=p_event_type)
      and (p_user_id is null or exists(select 1 from public.anticheat_event_subjects s
        where s.event_id=e.id and s.user_id=p_user_id))
  ), page as materialized (
    select * from filtered order by occurred_at desc,id desc limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'occurredAt',e.occurred_at,'type',e.event_type,'subjectId',e.subject_id,
      'amount',e.amount,'cardCount',e.card_count,'metadata',e.metadata,
      'actor',case when e.actor_user_id is null then null else jsonb_build_object('id',e.actor_user_id,'pseudo',e.actor_pseudo) end,
      'counterparty',case when e.counterparty_user_id is null then null else jsonb_build_object('id',e.counterparty_user_id,'pseudo',e.counterparty_pseudo) end,
      'subjects',coalesce((select jsonb_agg(jsonb_build_object(
        'userId',s.user_id,'pseudo',coalesce(sp.pseudo,'Deleted player'),
        'riskPoints',s.risk_points,'reasonCodes',s.reason_codes
      ) order by s.risk_points desc,s.user_id) from public.anticheat_event_subjects s
        left join public.user_profiles sp on sp.user_id=s.user_id where s.event_id=e.id),'[]'::jsonb)
    ) order by e.occurred_at desc,e.id desc) from page e),'[]'::jsonb),
    'total',(select count(*) from filtered)
  ) into result;
  return result;
end; $$;
revoke all on function public.admin_list_anticheat_events(uuid,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_list_anticheat_events(uuid,text,integer,integer) to authenticated;

notify pgrst,'reload schema';
commit;
