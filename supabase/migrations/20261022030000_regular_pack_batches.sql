begin;

-- Bounded, atomic composition of the existing authoritative single-pack draw.
-- SECURITY INVOKER deliberately adds no table privileges or privileged helper.
-- The inner function retains its profile row lock until this transaction ends;
-- any later failure rolls back every draw, quota change and achievement in the lot.
create function public.open_regular_packs(p_count integer)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  result jsonb := '[]'::jsonb;
  pack_status jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_count is null or p_count not in (1, 5, 10) then
    raise exception 'INVALID_PACK_COUNT';
  end if;
  pack_status := public.get_regular_pack_status();
  if (pack_status->>'available')::integer < p_count then
    raise exception 'INSUFFICIENT_PACKS';
  end if;
  for pack_index in 1..p_count loop
    result := result || public.open_regular_pack();
  end loop;
  return result;
end;
$$;

revoke all on function public.open_regular_packs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.open_regular_packs(integer) to authenticated;

commit;
