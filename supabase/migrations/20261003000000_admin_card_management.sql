begin;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('card.create','card.update','card.delete','card.import')),
  card_id uuid,
  card_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_logs_created_at_idx on public.admin_audit_logs(created_at desc);
create index admin_audit_logs_admin_user_idx on public.admin_audit_logs(admin_user_id, created_at desc);

alter table public.admin_users enable row level security;
alter table public.admin_audit_logs enable row level security;
revoke all on table public.admin_users, public.admin_audit_logs from public, anon, authenticated;
grant all on table public.admin_users, public.admin_audit_logs to service_role;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

revoke all on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;

-- Admin catalogue writes use the authenticated session and remain protected by
-- RLS. The web application never receives the service-role key.
grant insert, update, delete on table public.cards, public.card_categories to authenticated;
create policy cards_admin_insert on public.cards for insert to authenticated
  with check ((select public.is_current_user_admin()));
create policy cards_admin_update on public.cards for update to authenticated
  using ((select public.is_current_user_admin()))
  with check ((select public.is_current_user_admin()));
create policy cards_admin_delete on public.cards for delete to authenticated
  using ((select public.is_current_user_admin()));
create policy card_categories_admin_all on public.card_categories for all to authenticated
  using ((select public.is_current_user_admin()))
  with check ((select public.is_current_user_admin()));

grant insert on table public.admin_audit_logs to authenticated;
grant usage, select on sequence public.admin_audit_logs_id_seq to authenticated;
create policy admin_audit_logs_insert_self on public.admin_audit_logs for insert to authenticated
  with check (
    admin_user_id = (select auth.uid())
    and (select public.is_current_user_admin())
  );

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('card-images','card-images',true,6291456,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=true,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy card_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id='card-images' and (select public.is_current_user_admin()));
create policy card_images_admin_update on storage.objects for update to authenticated
  using (bucket_id='card-images' and (select public.is_current_user_admin()))
  with check (bucket_id='card-images' and (select public.is_current_user_admin()));

create or replace function public.admin_card_reference_counts(p_card_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode='P0001';
  end if;
  return jsonb_build_object(
    'owned', (select count(*) from public.user_cards where card_id=p_card_id),
    'choices', (select count(*) from public.decision_pack_choices where card_id=p_card_id)
  );
end;
$$;
revoke all on function public.admin_card_reference_counts(uuid) from public, anon;
grant execute on function public.admin_card_reference_counts(uuid) to authenticated;

commit;
