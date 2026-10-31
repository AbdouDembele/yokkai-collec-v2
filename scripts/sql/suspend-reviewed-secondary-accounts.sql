-- Owner only, in the SAME transaction as the three committed sanction receipts.
-- secondary_scope(operation_id text,user_id uuid,referral_id uuid,sponsor_id uuid,email_domain text)
-- No account deletion, auction cancellation, reward reversal or economic write.
do $$
declare actor record; old_ban timestamptz; result jsonb; results jsonb:='[]';
  sessions_before integer; refresh_before integer; receipts integer;
begin
 if session_user<>'postgres' or current_setting('yokkai.economic_operator',true)<>'on'
 or not (select active from public.economic_maintenance_state)
 or (select count(*)from secondary_scope)<>28 or (select count(distinct user_id)from secondary_scope)<>28
 or (select count(distinct operation_id)from secondary_scope)<>28 then raise exception 'SECONDARY_SCOPE_STOP';end if;
 select count(*)into receipts from public.account_sanctions s join sanction_scope x using(operation_id)where s.status='APPLIED';
 if receipts<>3 then raise exception 'PRIMARY_RECEIPTS_REQUIRED';end if;
 -- A fully committed identical batch is a no-op; never double revoke/penalize.
 if (select sum(jsonb_array_length(coalesce(s.metadata->'secondary_actions','[]')))from public.account_sanctions s join sanction_scope x using(operation_id))=28 then
   if exists(select 1 from secondary_scope x where not exists(select 1 from public.account_sanctions s join sanction_scope y using(operation_id),jsonb_array_elements(coalesce(s.metadata->'secondary_actions','[]'))a where a->>'operation_id'=x.operation_id and a->>'user_id'=x.user_id::text))then raise exception 'SECONDARY_EXISTING_SCOPE_MISMATCH';end if;
   return;
 end if;
 if exists(select 1 from public.account_sanctions s join sanction_scope x using(operation_id)where s.metadata ? 'secondary_actions')then raise exception 'SECONDARY_PARTIAL_JOURNAL_STOP';end if;
 if (select count(*)from secondary_scope x join auth.users u on u.id=x.user_id
   join public.referrals r on r.id=x.referral_id and r.referred_id=x.user_id and r.referrer_id=x.sponsor_id
   where lower(split_part(u.email,'@',2))=x.email_domain)=28 then null;
 else raise exception 'SECONDARY_IDENTITY_CHANGED_STOP';end if;
 if exists(select 1 from secondary_scope x join public.admin_users a on a.user_id=x.user_id)
 or exists(select 1 from secondary_scope x join sanction_scope s on s.user_id=x.user_id)
 then raise exception 'SECONDARY_PROTECTED_ACCOUNT_STOP';end if;
 perform u.id from auth.users u join secondary_scope x on x.user_id=u.id order by u.id for update of u;
 for actor in select *from secondary_scope order by user_id loop
   select banned_until into strict old_ban from auth.users where id=actor.user_id;
   select count(*)into sessions_before from auth.sessions where user_id=actor.user_id;
   select count(*)into refresh_before from auth.refresh_tokens where user_id::text=actor.user_id::text;
   update auth.users set banned_until='infinity',updated_at=clock_timestamp()where id=actor.user_id;
   delete from auth.refresh_tokens where user_id::text=actor.user_id::text;
   delete from auth.sessions where user_id=actor.user_id;
   if not exists(select 1 from auth.users where id=actor.user_id and banned_until>clock_timestamp())
   or exists(select 1 from auth.sessions where user_id=actor.user_id)
   or exists(select 1 from auth.refresh_tokens where user_id::text=actor.user_id::text)
   then raise exception 'SECONDARY_SUSPENSION_NOT_EFFECTIVE';end if;
   result:=jsonb_build_object('operation_id',actor.operation_id,'user_id',actor.user_id,
    'sponsor_id',actor.sponsor_id,'email_domain',actor.email_domain,'banned_until_before',old_ban,
    'banned_until_after','infinity','sessions_revoked',sessions_before,'refresh_tokens_revoked',refresh_before,
    'result',case when old_ban>now()then 'ALREADY_DISABLED'else 'DISABLED'end,
    'applied_at',clock_timestamp(),'cards_removed',0,'kara_removed',0,'deleted',false);
   results:=results||jsonb_build_array(result);
 end loop;
 update public.account_sanctions s set metadata=s.metadata||jsonb_build_object('secondary_actions',
  (select coalesce(jsonb_agg(a),'[]')from jsonb_array_elements(results)a where a->>'sponsor_id'=s.user_id::text))
 from sanction_scope x where x.operation_id=s.operation_id and x.penalize;
 if (select sum(jsonb_array_length(coalesce(s.metadata->'secondary_actions','[]')))from public.account_sanctions s join sanction_scope x using(operation_id))<>28 then raise exception 'SECONDARY_RECEIPT_COUNT_STOP';end if;
end;$$;
