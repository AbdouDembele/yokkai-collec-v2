-- Owner-operated ONLY, inside one caller-owned transaction. Inputs are TEMP
-- tables from a separately reviewed, hash-verified scope, never API arguments.
-- Caller: begin; SET LOCAL timeouts; create inputs; this file; commit.
-- sanction_scope(user_id uuid, operation_id text, sanction_type text,
--   expected_pseudo text, remove_cards boolean, penalize boolean)
-- sanction_targets(id uuid); sanction_config(metadata jsonb, quiescent boolean)
-- No notification is published here; release only after committed post-checks.
select pg_advisory_xact_lock(hashtextextended('yokkai:referral-sanctions-apply',0));

-- Requires the dedicated operator connection to own the exclusive admission
-- lock after drain. No table-wide exclusive locks: consultations remain possible.
do $$begin
 if session_user<>'postgres' or not coalesce((select active from public.economic_maintenance_state),false)
 or not exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory'
 and classid=710031 and objid=2100 and objsubid=2 and mode='ExclusiveLock' and granted)
 then raise exception 'ECONOMIC_MAINTENANCE_DRAIN_REQUIRED';end if;
end;$$;
set local yokkai.economic_operator='on';
select p.user_id from public.user_profiles p join sanction_scope s on s.user_id=p.user_id order by p.user_id for update of p;
select c.id from public.user_cards c join sanction_targets t using(id) order by c.id for update of c;

do $$
declare actor record; before_balance integer; penalty integer; removed jsonb;
  before_profile jsonb; before_cards jsonb; skipped jsonb; existing integer;
  before_protected jsonb; after_cards jsonb;
begin
  if (select count(*) from sanction_scope)<>3
    or (select count(distinct user_id) from sanction_scope)<>3
    or (select count(distinct operation_id) from sanction_scope)<>3
    or (select count(*) from sanction_scope where remove_cards and penalize and sanction_type='AFFILIATE_ABUSE_SANCTION')<>1
    or (select count(*) from sanction_scope where not remove_cards and penalize and sanction_type='AFFILIATE_ABUSE_WARNING_WITH_PENALTY')<>1
    or (select count(*) from sanction_scope where not remove_cards and not penalize and sanction_type='AFFILIATE_ABUSE_WARNING')<>1
    or (select count(*) from sanction_targets)<>75
    or (select count(distinct id) from sanction_targets)<>75 then raise exception 'INVALID_EXACT_SCOPE'; end if;

  select count(*) into existing from public.account_sanctions s join sanction_scope x using(operation_id);
  if existing=3 and not exists(select 1 from public.account_sanctions s join sanction_scope x using(operation_id)
    where s.status<>'APPLIED' or s.user_id<>x.user_id or s.sanction_type<>x.sanction_type) then return; end if;
  if existing<>0 then raise exception 'EXISTING_PARTIAL_OR_ROLLED_BACK_BATCH'; end if;


  if (select count(*) from sanction_scope s join auth.users u on u.id=s.user_id
    join public.user_profiles p on p.user_id=s.user_id and p.pseudo=s.expected_pseudo)<>3 then raise exception 'ACCOUNT_IDENTITY_CHANGED'; end if;


  select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into before_protected
    from public.user_cards c join sanction_targets t using(id)
    where c.user_id<>(select user_id from sanction_scope where remove_cards);
  for actor in select * from sanction_scope order by user_id loop
    select karas_balance,to_jsonb(p) into strict before_balance,before_profile
      from public.user_profiles p where p.user_id=actor.user_id for update;
    select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into before_cards
      from public.user_cards c where c.user_id=actor.user_id;
    penalty:=case when actor.penalize then before_balance/2 else 0 end;
    removed:='[]'; skipped:='[]';
    if actor.remove_cards then
      select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'owner',c.user_id,'classification',
        case when c.id is null then 'MISSING_REVIEW' when c.user_id<>actor.user_id then 'PROTECTED_THIRD_PARTY' else 'PENDING_REVIEW' end)order by t.id),'[]')into skipped
      from sanction_targets t left join public.user_cards c using(id)
      where c.id is null or c.user_id<>actor.user_id or c.is_locked
      or exists(select 1 from public.auctions a where a.card_instance_id=t.id)
      or exists(select 1 from public.trade_offers o where o.status='pending'and t.id=any(o.offered_card_ids||o.requested_card_ids));
      with deleted as(delete from public.user_cards c using sanction_targets t
        where c.id=t.id and c.user_id=actor.user_id and not exists(select 1 from jsonb_array_elements(skipped)x where (x->>'id')::uuid=c.id) returning c.*)
      select coalesce(jsonb_agg(to_jsonb(deleted) order by id),'[]') into removed from deleted;
      if jsonb_array_length(removed)+jsonb_array_length(skipped)<>75 then raise exception 'REMOVAL_COUNT_MISMATCH'; end if;
    end if;
    if actor.penalize then update public.user_profiles set karas_balance=before_balance-penalty where user_id=actor.user_id; end if;
    set constraints all immediate;
    select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into after_cards
      from public.user_cards c where c.user_id=actor.user_id;
    if after_cards<>(select coalesce(jsonb_agg(b.value order by b.value->>'id'),'[]') from jsonb_array_elements(before_cards) b(value)
      where not exists(select 1 from jsonb_array_elements(removed) r(value) where r.value->>'id'=b.value->>'id'))
      then raise exception 'UNEXPECTED_INVENTORY_CHANGE'; end if;
    insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,
      cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,status,metadata)
    values(actor.operation_id,actor.user_id,actor.sanction_type,'AFFILIATE_ABUSE',
      case when actor.remove_cards then 'PROVEN_ASSET_REMOVAL' else 'NONE' end,
      case when actor.penalize then 'ADMIN_DISCIPLINARY_PENALTY' else 'NONE' end,
      jsonb_array_length(removed),penalty,before_balance,before_balance-penalty,clock_timestamp(),'APPLIED',
      (select metadata from sanction_config)||jsonb_build_object('profile_before',before_profile,
      'profile_after',(select to_jsonb(p) from public.user_profiles p where p.user_id=actor.user_id),
      'inventory_before',before_cards,'inventory_after',after_cards,'removed_cards',removed,'protected_moved_cards',skipped,
      'culpability',case when actor.penalize then 'ADMIN_DECISION' else 'LOW_SUSPICION' end,
      'kara_provenance','NOT_PROVEN_FRAUD_PROCEEDS'));
  end loop;
  if before_protected<>(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]')
    from public.user_cards c join sanction_targets t using(id)
    where c.user_id<>(select user_id from sanction_scope where remove_cards)) then raise exception 'THIRD_PARTY_CHANGED'; end if;
end; $$;
