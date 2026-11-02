begin;
create table public.anticheat_deleted_account_sanctions (
 id uuid primary key default gen_random_uuid(),primary_user_id uuid not null,deleted_user_ids uuid[] not null,
 admin_user_id uuid,note text not null check(length(note)between 10 and 2000),history jsonb not null,
 recovery jsonb not null,preparation jsonb not null,applied_at timestamptz not null default clock_timestamp()
);
create table public.anticheat_deleted_account_claims (
 kind text not null check(kind in('trade','auction')),asset_id uuid not null,
 receipt_id uuid not null references public.anticheat_deleted_account_sanctions(id)on delete restrict,
 primary key(kind,asset_id)
);
alter table public.anticheat_deleted_account_sanctions enable row level security;
alter table public.anticheat_deleted_account_claims enable row level security;
revoke all on public.anticheat_deleted_account_sanctions,public.anticheat_deleted_account_claims from public,anon,authenticated,service_role;
create trigger anticheat_deleted_account_sanctions_immutable before update or delete on public.anticheat_deleted_account_sanctions for each row execute function public.prevent_anticheat_ledger_mutation();
create trigger anticheat_deleted_account_claims_immutable before update or delete on public.anticheat_deleted_account_claims for each row execute function public.prevent_anticheat_ledger_mutation();
create index anticheat_deleted_account_receipts_primary_idx on public.anticheat_deleted_account_sanctions(primary_user_id,applied_at desc);

create function public.anticheat_deleted_transfer_available(p_kind text,p_id uuid)
returns boolean language sql stable set search_path='' as $$
 select not exists(select 1 from public.anticheat_deleted_account_claims where kind=p_kind and asset_id=p_id)
 and not exists(select 1 from public.anticheat_deleted_smurf_recovery_items where kind=p_kind and item_id=p_id)
 and not exists(select 1 from public.anticheat_smurf_sanctions s where
   (p_kind='trade'and p_id=any(s.accepted_trade_ids))or(p_kind='auction'and p_id=any(s.source_auction_ids)))
$$;
revoke all on function public.anticheat_deleted_transfer_available(text,uuid)from public,anon,authenticated,service_role;

create function public.admin_list_deleted_accounts(p_query text default'',p_primary_user_id uuid default null,
 p_related_only boolean default true,p_limit integer default 30,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;stamp timestamptz:=clock_timestamp();
begin
 perform public.assert_player_not_banned();if not public.is_current_user_admin()then raise exception'ADMIN_REQUIRED';end if;
 p_query:=left(btrim(coalesce(p_query,'')),100);p_limit:=least(greatest(coalesce(p_limit,30),1),50);p_offset:=greatest(coalesce(p_offset,0),0);
 with records as materialized(
 select d.user_id,d.deleted_at,d.identity_expires_at,d.identity_source,
   case when d.identity_expires_at>stamp then d.pseudo end pseudo,case when d.identity_expires_at>stamp then d.email end email,
   (select count(*)from public.anticheat_deleted_account_transfers e where
    ((e.from_user_id=d.user_id and e.to_user_id=p_primary_user_id)or(e.to_user_id=d.user_id and e.from_user_id=p_primary_user_id)))link_count,
   (select count(*)from public.anticheat_deleted_account_transfers e where
    ((e.from_user_id=d.user_id and e.to_user_id=p_primary_user_id)or(e.to_user_id=d.user_id and e.from_user_id=p_primary_user_id))and public.anticheat_deleted_transfer_available(e.kind,e.asset_id))available_count
 from public.anticheat_deleted_accounts d where not exists(select 1 from auth.users u where u.id=d.user_id)
 ), filtered as materialized(select*from records r where
   (p_query=''or coalesce(r.pseudo,'')ilike'%'||p_query||'%'or coalesce(r.email,'')ilike'%'||p_query||'%')
   and(not coalesce(p_related_only,true)or p_primary_user_id is null or r.link_count>0)
 ),page as(select*from filtered order by(link_count>0)desc,deleted_at desc,user_id limit p_limit offset p_offset)
 select jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'pseudo',pseudo,'email',email,
   'deletedAt',deleted_at,'identityExpiresAt',identity_expires_at,'identitySource',identity_source,'transfers',link_count,'availableTransfers',available_count)order by(link_count>0)desc,deleted_at desc,user_id)from page),'[]'),
   'total',(select count(*)from filtered),'deletedTotal',(select count(*)from records),'pageSize',p_limit)into result;return result;
end;$$;

create function public.admin_preview_deleted_account_sanction(p_primary_user_id uuid,p_deleted_user_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;history jsonb;labels jsonb;sources jsonb;received uuid[];owned uuid[];sale_ids uuid[];
 source_ids uuid[];sale_amount integer;net_amount integer;balance integer;valid boolean;blocked integer;total integer;
begin
 perform public.assert_player_not_banned();if not public.is_current_user_admin()then raise exception'ADMIN_REQUIRED';end if;
 p_deleted_user_ids:=coalesce(p_deleted_user_ids,'{}');
 if cardinality(p_deleted_user_ids)>20 or array_position(p_deleted_user_ids,null)is not null
 or cardinality(p_deleted_user_ids)<>(select count(distinct id)from unnest(p_deleted_user_ids)id)then raise exception'INVALID_DELETED_ACCOUNTS';end if;
 select karas_balance into balance from public.user_profiles where user_id=p_primary_user_id;
 if not found or not exists(select 1 from auth.users where id=p_primary_user_id)or exists(select 1 from public.account_deletion_log where user_id=p_primary_user_id)then raise exception'PLAYER_NOT_FOUND';end if;
 valid:=cardinality(p_deleted_user_ids)>0 and not exists(select 1 from unnest(p_deleted_user_ids)chosen(user_id) where
   chosen.user_id=p_primary_user_id or exists(select 1 from auth.users u where u.id=chosen.user_id)or not exists(select 1 from public.anticheat_deleted_accounts d where d.user_id=chosen.user_id)
   or not exists(select 1 from public.anticheat_deleted_account_transfers e where
     ((e.from_user_id=chosen.user_id and e.to_user_id=p_primary_user_id)or(e.to_user_id=chosen.user_id and e.from_user_id=p_primary_user_id))and public.anticheat_deleted_transfer_available(e.kind,e.asset_id)));
 with edges as materialized(select*from public.anticheat_deleted_account_transfers e where
  ((e.from_user_id=any(p_deleted_user_ids)and e.to_user_id=p_primary_user_id)or(e.to_user_id=any(p_deleted_user_ids)and e.from_user_id=p_primary_user_id))
  and public.anticheat_deleted_transfer_available(e.kind,e.asset_id))
 select coalesce(jsonb_agg(to_jsonb(e)order by occurred_at,kind,asset_id),'[]'),
   greatest(coalesce(sum(case when to_user_id=p_primary_user_id then offered_karas-requested_karas else requested_karas-offered_karas end),0),0)::integer,
   coalesce(array_agg(asset_id),'{}'),
   coalesce((select array_agg(distinct id)from edges x cross join lateral unnest(case when x.to_user_id=p_primary_user_id then x.offered_card_ids else x.requested_card_ids end)id),'{}')
 into sources,net_amount,source_ids,received from edges e;
 select coalesce(array_agg(id order by id),'{}'),count(*)filter(where is_locked)::integer into owned,blocked from public.user_cards where user_id=p_primary_user_id and id=any(received);
 select coalesce(jsonb_object_agg(kv.key,kv.value),'{}')into labels from jsonb_array_elements(sources)s cross join lateral jsonb_each(s->'card_labels')kv;
 with incoming as(select id,min((s->>'occurred_at')::timestamptz) received_at from jsonb_array_elements(sources)s
  cross join lateral jsonb_array_elements_text(case when(s->>'to_user_id')::uuid=p_primary_user_id then s->'offered_card_ids'else s->'requested_card_ids'end)c(id)group by id)
 select coalesce(array_agg(a.id order by a.created_at,a.id),'{}'),coalesce(sum(a.current_price),0)::integer into sale_ids,sale_amount
 from public.auctions a join incoming i on i.id::uuid=a.card_instance_id where a.status='sold'and a.seller_id=p_primary_user_id and a.created_at>=i.received_at
  and not a.id=any(source_ids)and public.anticheat_deleted_transfer_available('auction',a.id);
 total:=net_amount+sale_amount;
 history:=jsonb_build_object('transfers',sources,'cardLabels',labels,'sales',coalesce((select jsonb_agg(jsonb_build_object('id',id,'cardInstanceId',card_instance_id,'karas',current_price))from public.auctions where id=any(sale_ids)),'[]'));
 result:=jsonb_build_object('primary',jsonb_build_object('userId',p_primary_user_id,'pseudo',(select pseudo from public.user_profiles where user_id=p_primary_user_id),'karasBalance',balance),
  'selectedAccountIds',p_deleted_user_ids,'selectionValid',valid,'history',history,
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'pseudo',case when identity_expires_at>clock_timestamp()then pseudo end,'email',case when identity_expires_at>clock_timestamp()then email end))from public.anticheat_deleted_accounts where user_id=any(p_deleted_user_ids)),'[]'),
  'recovery',jsonb_build_object('cardIds',owned,'cards',cardinality(owned),'unavailableCards',cardinality(received)-cardinality(owned),'lockedCards',blocked,
   'transferKaras',net_amount,'saleKaras',sale_amount,'karas',total,'saleIds',sale_ids,'transfers',jsonb_array_length(sources)),
  'eligible',valid and not exists(select 1 from public.admin_users where user_id=p_primary_user_id)and balance>=total and(cardinality(owned)>0 or total>0));
 return result||jsonb_build_object('previewToken',md5(((result->'history')||(result->'recovery'))::text));
end;$$;

alter table public.admin_audit_logs drop constraint admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check(action in(
 'card.create','card.update','card.delete','card.import','card.bulk_delete','player.ban','player.unban','player.card.remove','report.status.change','card_report.status.change','wall_content.delete',
 'private_message.moderate','wall_media.moderate','anticheat.smurf_sanction','anticheat.deleted_smurf_recovery','anticheat.deleted_account_sanction','anticheat.deleted_identity_backfill'));

create function public.admin_apply_deleted_account_sanction(p_primary_user_id uuid,p_deleted_user_ids uuid[],p_note text,p_confirmation uuid,p_preview_token text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare before_preview jsonb;preview jsonb;cards uuid[];source_ids uuid[];sale_ids uuid[];receipt uuid:=gen_random_uuid();sale record;preparation jsonb;amount integer;affected integer;
begin
 perform public.assert_player_not_banned();if not public.is_current_user_admin()then raise exception'ADMIN_REQUIRED';end if;
 if p_primary_user_id is null or p_confirmation is distinct from p_primary_user_id then raise exception'SANCTION_CONFIRMATION_REQUIRED';end if;
 p_note:=btrim(coalesce(p_note,''));if length(p_note)not between 10 and 2000 then raise exception'INVALID_SANCTION_NOTE';end if;
 perform pg_advisory_xact_lock(hashtextextended('deleted-smurf-recovery:'||p_primary_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_primary_user_id::text,0));
 before_preview:=public.admin_preview_deleted_account_sanction(p_primary_user_id,p_deleted_user_ids);
 if p_preview_token is distinct from before_preview->>'previewToken'then raise exception'SANCTION_PREVIEW_CHANGED';end if;
 if not coalesce((before_preview->>'eligible')::boolean,false)then raise exception'DELETED_ACCOUNTS_NOT_ELIGIBLE';end if;
 select coalesce(array_agg(v::uuid),'{}')into cards from jsonb_array_elements_text(before_preview#>'{recovery,cardIds}')v;
 select coalesce(array_agg((v->>'asset_id')::uuid),'{}')into source_ids from jsonb_array_elements(before_preview#>'{history,transfers}')v;
 select coalesce(array_agg(v::uuid),'{}')into sale_ids from jsonb_array_elements_text(before_preview#>'{recovery,saleIds}')v;
 perform 1 from public.auctions where id=any(source_ids||sale_ids)or(status='active'and card_instance_id=any(cards))order by id for update;
 perform 1 from public.trade_offers where id=any(source_ids)or(status='pending'and(offered_card_ids&&cards or requested_card_ids&&cards))order by id for update;
 perform 1 from auth.users where id=p_primary_user_id for update;
 perform 1 from public.user_profiles where user_id=p_primary_user_id or user_id in(select buyer_id from public.auctions where status='active'and card_instance_id=any(cards))order by user_id for update;
 perform 1 from public.user_cards where id=any(cards)order by id for update;
 preview:=public.admin_preview_deleted_account_sanction(p_primary_user_id,p_deleted_user_ids);
 if not coalesce((preview->>'eligible')::boolean,false)or preview->>'previewToken'<>before_preview->>'previewToken'then raise exception'SANCTION_PREVIEW_CHANGED';end if;
 preparation:=jsonb_build_object('unlockedCardIds',coalesce((select jsonb_agg(id)from public.user_cards where id=any(cards)and is_locked),'[]'),
  'cancelledAuctions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'buyerId',buyer_id,'refund',case when buyer_id is null then 0 else current_price end))from public.auctions where status='active'and card_instance_id=any(cards)),'[]'),
  'cancelledTradeIds',coalesce((select jsonb_agg(id)from public.trade_offers where status='pending'and(offered_card_ids&&cards or requested_card_ids&&cards)),'[]'));
 for sale in select*from public.auctions where status='active'and card_instance_id=any(cards)order by id loop
  if sale.buyer_id is not null then perform public.credit_karas(sale.buyer_id,sale.current_price);end if;
  update public.auctions set status='expired',buyer_id=null,current_price=starting_price where id=sale.id;
 end loop;
 update public.trade_offers set status='cancelled',updated_at=clock_timestamp()where status='pending'and(offered_card_ids&&cards or requested_card_ids&&cards);
 update public.user_cards set is_locked=false where id=any(cards)and is_locked;
 amount:=(preview#>>'{recovery,karas}')::integer;
 insert into public.anticheat_deleted_account_sanctions(id,primary_user_id,deleted_user_ids,admin_user_id,note,history,recovery,preparation)
  values(receipt,p_primary_user_id,p_deleted_user_ids,auth.uid(),p_note,preview->'history',preview->'recovery',preparation);
 insert into public.anticheat_deleted_account_claims(kind,asset_id,receipt_id)
  select v->>'kind',(v->>'asset_id')::uuid,receipt from jsonb_array_elements(preview#>'{history,transfers}')v;
 insert into public.anticheat_deleted_account_claims(kind,asset_id,receipt_id)select'auction',id,receipt from unnest(sale_ids)id;
 delete from public.user_cards where user_id=p_primary_user_id and id=any(cards);
 get diagnostics affected=row_count;if affected<>cardinality(cards)then raise exception'RECOVERY_ASSETS_CHANGED';end if;
 update public.user_profiles set karas_balance=karas_balance-amount where user_id=p_primary_user_id and karas_balance>=amount;
 if not found then raise exception'RECOVERY_ASSETS_CHANGED';end if;
 insert into public.admin_audit_logs(admin_user_id,action,metadata)values(auth.uid(),'anticheat.deleted_account_sanction',
  jsonb_build_object('receiptId',receipt,'primaryUserId',p_primary_user_id,'deletedUserIds',p_deleted_user_ids,'recovery',preview->'recovery','preparation',preparation,'note',p_note));
 return jsonb_build_object('receiptId',receipt,'cardsRecovered',cardinality(cards),'karasRecovered',amount);
end;$$;
revoke all on function public.admin_list_deleted_accounts(text,uuid,boolean,integer,integer),public.admin_preview_deleted_account_sanction(uuid,uuid[]),public.admin_apply_deleted_account_sanction(uuid,uuid[],text,uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.admin_list_deleted_accounts(text,uuid,boolean,integer,integer),public.admin_preview_deleted_account_sanction(uuid,uuid[]),public.admin_apply_deleted_account_sanction(uuid,uuid[],text,uuid,text)to authenticated;

-- Existing historical and manual paths must observe these newer claims too.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.anticheat_deleted_smurf_trade_scope(uuid)'::regprocedure);
 if position('and not exists(select 1 from public.anticheat_smurf_sanctions'in definition)=0 then raise exception'CLAIM_FENCE_PATCH_MISMATCH';end if;
 definition:=replace(definition,'and not exists(select 1 from public.anticheat_smurf_sanctions','and not exists(select 1 from public.anticheat_deleted_account_claims c where c.kind=''trade'' and c.asset_id=t.id) and not exists(select 1 from public.anticheat_smurf_sanctions');execute definition;
 definition:=pg_get_functiondef('public.admin_preview_smurf_sanction(uuid,uuid)'::regprocedure);
 if position('and a.created_at>=source.received_at;'in definition)=0 then raise exception'CLAIM_FENCE_PATCH_MISMATCH';end if;
 definition:=replace(definition,'and a.created_at>=source.received_at;','and a.created_at>=source.received_at and not exists(select 1 from public.anticheat_deleted_account_claims c where c.kind=''auction'' and c.asset_id=a.id);');execute definition;
 definition:=pg_get_functiondef('public.admin_preview_deleted_smurf_recovery(uuid,uuid[])'::regprocedure);
 if position('and not exists(select 1 from public.anticheat_smurf_sanctions s where a.id=any(s.source_auction_ids))'in definition)=0 then raise exception'CLAIM_FENCE_PATCH_MISMATCH';end if;
 definition:=replace(definition,'and not exists(select 1 from public.anticheat_smurf_sanctions s where a.id=any(s.source_auction_ids))','and not exists(select 1 from public.anticheat_deleted_account_claims c where c.kind=''auction'' and c.asset_id=a.id) and not exists(select 1 from public.anticheat_smurf_sanctions s where a.id=any(s.source_auction_ids))');execute definition;
end;$$;
notify pgrst,'reload schema';commit;
