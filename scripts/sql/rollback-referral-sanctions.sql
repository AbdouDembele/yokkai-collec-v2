-- Owner-only recovery, not an API. Caller supplies the SAME sanction_scope and
-- starts a transaction with strict timeouts. STOP if any before/after guard fails.
select pg_advisory_xact_lock(hashtextextended('yokkai:referral-sanctions-apply',0));
lock table public.user_cards,public.user_profiles,public.auctions,public.trade_offers in access exclusive mode;
do $$
declare receipt record; current_cards jsonb; current_profile jsonb;
begin
  if (select count(*) from sanction_scope)<>3 or
    (select count(*) from public.account_sanctions s join sanction_scope x using(operation_id) where s.status='APPLIED' and s.user_id=x.user_id)<>3
    then raise exception 'ROLLBACK_SCOPE_STOP'; end if;
  if exists(select 1 from public.account_sanctions s join sanction_scope x using(operation_id) where s.notification_seen_at is not null)
    then raise exception 'RECEIPT_ALREADY_ACKNOWLEDGED_STOP'; end if;
  for receipt in select s.* from public.account_sanctions s join sanction_scope x using(operation_id) order by s.user_id loop
    select to_jsonb(p) into current_profile from public.user_profiles p where p.user_id=receipt.user_id;
    select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into current_cards from public.user_cards c where c.user_id=receipt.user_id;
    if current_profile is distinct from receipt.metadata->'profile_after' or current_cards is distinct from receipt.metadata->'inventory_after'
      then raise exception 'PLAYER_STATE_CHANGED_STOP'; end if;
    if exists(select 1 from jsonb_array_elements(receipt.metadata->'removed_cards') r
      join public.user_cards c on c.id=(r->>'id')::uuid) then raise exception 'CARD_ID_REUSED_STOP'; end if;
    -- Recoveries must never grant achievement rewards for re-inserting copies.
    alter table public.user_cards disable trigger user_cards_inserted_achievements;
    insert into public.user_cards select * from jsonb_populate_recordset(null::public.user_cards,receipt.metadata->'removed_cards');
    alter table public.user_cards enable trigger user_cards_inserted_achievements;
    update public.user_profiles set karas_balance=receipt.kara_balance_before,
      banner_card_id=(receipt.metadata->'profile_before'->>'banner_card_id')::uuid,
      banner_url=receipt.metadata->'profile_before'->>'banner_url',
      banner_frame=nullif(receipt.metadata->'profile_before'->'banner_frame','null'::jsonb),
      banner_frame_source=receipt.metadata->'profile_before'->>'banner_frame_source'
      where user_id=receipt.user_id;
    if (select to_jsonb(p) from public.user_profiles p where p.user_id=receipt.user_id)<>receipt.metadata->'profile_before'
      then raise exception 'PROFILE_RESTORE_MISMATCH'; end if;
    update public.account_sanctions set status='ROLLED_BACK',published_at=null,
      metadata=metadata||jsonb_build_object('rolled_back_at',clock_timestamp()) where id=receipt.id;
  end loop;
end; $$;
