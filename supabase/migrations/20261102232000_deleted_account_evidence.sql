begin;

create table public.anticheat_deleted_accounts (
  user_id uuid primary key,
  deleted_at timestamptz not null,
  identity_expires_at timestamptz not null,
  pseudo text,
  email text,
  identity_source text not null default 'unavailable',
  source_reference text,
  check(identity_expires_at<=deleted_at+interval '90 days')
);
create index anticheat_deleted_accounts_expiry_idx on public.anticheat_deleted_accounts(identity_expires_at)
  where pseudo is not null or email is not null;
create table public.anticheat_deleted_account_transfers (
  kind text not null check(kind in ('trade','auction')),
  asset_id uuid not null,
  from_user_id uuid not null,
  to_user_id uuid not null,
  offered_card_ids uuid[] not null default '{}',
  requested_card_ids uuid[] not null default '{}',
  offered_karas integer not null check(offered_karas>=0),
  requested_karas integer not null check(requested_karas>=0),
  occurred_at timestamptz not null,
  card_labels jsonb not null default '{}',
  offered_names jsonb not null default '[]',
  requested_names jsonb not null default '[]',
  evidence_source text not null,
  source_reference text,
  primary key(kind,asset_id),check(from_user_id<>to_user_id)
);
create index anticheat_deleted_transfers_from_idx on public.anticheat_deleted_account_transfers(from_user_id,to_user_id,occurred_at);
create index anticheat_deleted_transfers_to_idx on public.anticheat_deleted_account_transfers(to_user_id,from_user_id,occurred_at);
alter table public.anticheat_deleted_accounts enable row level security;
alter table public.anticheat_deleted_account_transfers enable row level security;
revoke all on public.anticheat_deleted_accounts,public.anticheat_deleted_account_transfers from public,anon,authenticated,service_role;
create trigger anticheat_deleted_account_transfers_immutable before update or delete on public.anticheat_deleted_account_transfers
  for each row execute function public.prevent_anticheat_ledger_mutation();

create function public.anticheat_capture_deleted_account(p_user_id uuid,p_deleted_at timestamptz)
returns void language plpgsql set search_path='' as $$
declare stamp timestamptz:=coalesce(p_deleted_at,clock_timestamp());
begin
  insert into public.anticheat_deleted_accounts(user_id,deleted_at,identity_expires_at,pseudo,email,identity_source)
    select p_user_id,stamp,stamp+interval '90 days',
      case when stamp+interval '90 days'>clock_timestamp() then coalesce(p.pseudo,to_jsonb(u)->'raw_user_meta_data'->>'pseudo') end,
      case when stamp+interval '90 days'>clock_timestamp() then to_jsonb(u)->>'email' end,'deletion_snapshot'
    from auth.users u left join public.user_profiles p on p.user_id=u.id where u.id=p_user_id
    on conflict(user_id) do update set
      pseudo=case when public.anticheat_deleted_accounts.identity_expires_at>clock_timestamp() then coalesce(public.anticheat_deleted_accounts.pseudo,excluded.pseudo) end,
      email=case when public.anticheat_deleted_accounts.identity_expires_at>clock_timestamp() then coalesce(public.anticheat_deleted_accounts.email,excluded.email) end,
      identity_source=case when public.anticheat_deleted_accounts.pseudo is null and public.anticheat_deleted_accounts.email is null then excluded.identity_source else public.anticheat_deleted_accounts.identity_source end;
  insert into public.anticheat_deleted_account_transfers(kind,asset_id,from_user_id,to_user_id,offered_card_ids,requested_card_ids,
    offered_karas,requested_karas,occurred_at,card_labels,offered_names,requested_names,evidence_source)
    select 'trade',t.id,t.from_user,t.to_user,t.offered_card_ids,t.requested_card_ids,t.offered_karas,t.requested_karas,t.updated_at,
      public.anticheat_sanction_card_labels(array[t.id],t.offered_card_ids||t.requested_card_ids),
      coalesce((select jsonb_agg(v->>'name') from jsonb_array_elements(coalesce(t.offered_cards_snapshot,public.trade_card_json(t.offered_card_ids)))v),'[]'),
      coalesce((select jsonb_agg(v->>'name') from jsonb_array_elements(coalesce(t.requested_cards_snapshot,public.trade_card_json(t.requested_card_ids)))v),'[]'),'deletion_snapshot'
    from public.trade_offers t where t.status='accepted' and p_user_id in(t.from_user,t.to_user)
      and t.from_user is not null and t.to_user is not null on conflict do nothing;
  insert into public.anticheat_deleted_account_transfers(kind,asset_id,from_user_id,to_user_id,offered_card_ids,requested_card_ids,
    offered_karas,requested_karas,occurred_at,card_labels,offered_names,evidence_source)
    select 'auction',a.id,a.seller_id,a.buyer_id,case when a.card_instance_id is null then '{}'::uuid[] else array[a.card_instance_id] end,'{}',0,a.current_price,
      coalesce((select min(e.occurred_at)from public.anticheat_events e where e.subject_id=a.id and e.event_type='auction_sold'),least(a.ends_at,clock_timestamp())),
      case when a.card_instance_id is null then '{}'::jsonb else jsonb_build_object(a.card_instance_id::text,jsonb_build_object('name',coalesce(c.nom,a.card_snapshot->>'name'),'rarity',coalesce(uc.rarity::text,a.card_snapshot->>'rarity'),'franchise',coalesce(c.franchise,a.card_snapshot->>'anime')))end,
      jsonb_build_array(coalesce(c.nom,a.card_snapshot->>'name')),'deletion_snapshot'
    from public.auctions a left join public.user_cards uc on uc.id=a.card_instance_id left join public.cards c on c.id=uc.card_id
    where a.status='sold' and p_user_id in(a.seller_id,a.buyer_id) and a.seller_id is not null and a.buyer_id is not null on conflict do nothing;
end; $$;
revoke all on function public.anticheat_capture_deleted_account(uuid,timestamptz) from public,anon,authenticated,service_role;
create function public.anticheat_deleted_account_snapshot_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_schema='auth' then
    perform public.anticheat_capture_deleted_account(old.id,coalesce((select deleted_at from public.account_deletion_log where user_id=old.id),clock_timestamp()));
    return old;
  else perform public.anticheat_capture_deleted_account(new.user_id,new.deleted_at);return new;end if;
end; $$;
revoke all on function public.anticheat_deleted_account_snapshot_trigger() from public,anon,authenticated,service_role;
create trigger anticheat_deleted_account_snapshot before insert on public.account_deletion_log
  for each row execute function public.anticheat_deleted_account_snapshot_trigger();
create trigger anticheat_deleted_auth_snapshot before delete on auth.users
  for each row execute function public.anticheat_deleted_account_snapshot_trigger();

-- Old identities remain unknown unless independently verified. Exact original
-- parties may still be known from immutable accepted-trade / sold-auction events.
insert into public.anticheat_deleted_accounts(user_id,deleted_at,identity_expires_at)
  select user_id,deleted_at,deleted_at+interval '90 days' from public.account_deletion_log on conflict do nothing;
insert into public.anticheat_deleted_account_transfers(kind,asset_id,from_user_id,to_user_id,offered_card_ids,requested_card_ids,
  offered_karas,requested_karas,occurred_at,card_labels,offered_names,requested_names,evidence_source,source_reference)
select distinct on(t.id) 'trade',t.id,e.actor_user_id,e.counterparty_user_id,t.offered_card_ids,t.requested_card_ids,
  coalesce((e.metadata->>'offeredKaras')::integer,t.offered_karas),coalesce((e.metadata->>'requestedKaras')::integer,t.requested_karas),e.occurred_at,
  public.anticheat_sanction_card_labels(array[t.id],t.offered_card_ids||t.requested_card_ids),
  coalesce((select jsonb_agg(v->>'name')from jsonb_array_elements(coalesce(t.offered_cards_snapshot,public.trade_card_json(t.offered_card_ids)))v),'[]'),
  coalesce((select jsonb_agg(v->>'name')from jsonb_array_elements(coalesce(t.requested_cards_snapshot,public.trade_card_json(t.requested_card_ids)))v),'[]'),'event_log',e.id::text
from public.anticheat_events e join public.trade_offers t on t.id=e.subject_id
where e.event_type='trade_accepted' and t.status='accepted' and e.actor_user_id is not null and e.counterparty_user_id is not null
  and exists(select 1 from public.anticheat_deleted_accounts d where d.user_id in(e.actor_user_id,e.counterparty_user_id))
order by t.id,e.occurred_at,e.id on conflict do nothing;
insert into public.anticheat_deleted_account_transfers(kind,asset_id,from_user_id,to_user_id,offered_card_ids,requested_card_ids,
  offered_karas,requested_karas,occurred_at,card_labels,offered_names,evidence_source,source_reference)
select distinct on(a.id) 'auction',a.id,e.actor_user_id,e.counterparty_user_id,
  case when a.card_instance_id is null then '{}'::uuid[] else array[a.card_instance_id] end,'{}',0,e.amount,e.occurred_at,
  case when a.card_instance_id is null then '{}'::jsonb else jsonb_build_object(a.card_instance_id::text,jsonb_build_object('name',coalesce(c.nom,a.card_snapshot->>'name'),'rarity',coalesce(uc.rarity::text,a.card_snapshot->>'rarity'),'franchise',coalesce(c.franchise,a.card_snapshot->>'anime')))end,
  jsonb_build_array(coalesce(c.nom,a.card_snapshot->>'name')),'event_log',e.id::text
from public.anticheat_events e join public.auctions a on a.id=e.subject_id
left join public.user_cards uc on uc.id=a.card_instance_id left join public.cards c on c.id=uc.card_id
where e.event_type='auction_sold' and a.status='sold' and e.actor_user_id is not null and e.counterparty_user_id is not null
  and e.amount=a.current_price and exists(select 1 from public.anticheat_deleted_accounts d where d.user_id in(e.actor_user_id,e.counterparty_user_id))
order by a.id,e.occurred_at,e.id on conflict do nothing;

create function public.purge_anticheat_deleted_identities()
returns integer language plpgsql set search_path='' as $$
declare affected integer;
begin
  update public.anticheat_deleted_accounts set pseudo=null,email=null
    where identity_expires_at<=clock_timestamp() and (pseudo is not null or email is not null);
  get diagnostics affected=row_count;return affected;
end; $$;
revoke all on function public.purge_anticheat_deleted_identities() from public,anon,authenticated,service_role;
select cron.schedule('purge-anticheat-deleted-identities','*/15 * * * *','select public.purge_anticheat_deleted_identities();');
select public.purge_anticheat_deleted_identities();
commit;
