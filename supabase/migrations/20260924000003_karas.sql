begin;

alter table public.user_profiles
  add column karas_balance integer not null default 0
  constraint user_profiles_karas_nonnegative check (karas_balance >= 0);

create function public.credit_karas(p_user_id uuid, p_amount integer)
returns integer language plpgsql volatile security definer set search_path = ''
as $$
declare balance integer;
begin
  if p_amount <= 0 then raise exception 'INVALID_KARAS_AMOUNT' using errcode = 'P0001'; end if;
  update public.user_profiles set karas_balance = karas_balance + p_amount
    where user_id = p_user_id returning karas_balance into balance;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  return balance;
end;
$$;

create function public.debit_karas(p_user_id uuid, p_amount integer)
returns integer language plpgsql volatile security definer set search_path = ''
as $$
declare balance integer;
begin
  if p_amount <= 0 then raise exception 'INVALID_KARAS_AMOUNT' using errcode = 'P0001'; end if;
  update public.user_profiles set karas_balance = karas_balance - p_amount
    where user_id = p_user_id and karas_balance >= p_amount
    returning karas_balance into balance;
  if found then return balance; end if;
  if not exists (select 1 from public.user_profiles where user_id = p_user_id) then
    raise exception 'PROFILE_MISSING' using errcode = 'P0001';
  end if;
  raise exception 'INSUFFICIENT_KARAS' using errcode = 'P0001';
end;
$$;

-- Server-only primitives for future market and trade transactions.
revoke all on function public.credit_karas(uuid, integer), public.debit_karas(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.credit_karas(uuid, integer), public.debit_karas(uuid, integer)
  to service_role;

create or replace function public.get_game_info()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  player_name text;
  balance integer;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select pseudo, karas_balance into player_name, balance
    from public.user_profiles where user_id = player_id;
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'user', jsonb_build_object('id', player_id, 'name', player_name),
    'karasBalance', balance,
    'categories', (select coalesce(jsonb_agg(categorie order by categorie), '[]'::jsonb)
      from (select distinct categorie from public.cards) as categories),
    'rarities', jsonb_build_array('C', 'R', 'SR', 'SSR', 'LR'),
    'dropRates', '[{"rarity":"C","percent":59},{"rarity":"R","percent":25},{"rarity":"SR","percent":10},{"rarity":"SSR","percent":5},{"rarity":"LR","percent":1}]'::jsonb,
    'shinyRate', 5
  );
end;
$$;

commit;
