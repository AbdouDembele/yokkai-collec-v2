create or replace function public.move_cards_to_folder(
  p_card_instance_ids uuid[],
  p_folder_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  moved_count integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if coalesce(cardinality(p_card_instance_ids), 0) < 1
    or cardinality(p_card_instance_ids) > 500
    or array_position(p_card_instance_ids, null) is not null then
    raise exception 'INVALID_CARD_SELECTION' using errcode = 'P0001';
  end if;

  if p_folder_id is not null and not exists (
    select 1
    from public.folders
    where id = p_folder_id and user_id = auth.uid()
  ) then
    raise exception 'FOLDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(p_card_instance_ids) as requested(id)
    where not exists (
      select 1
      from public.user_cards
      where user_cards.id = requested.id and user_cards.user_id = auth.uid()
    )
  ) then
    raise exception 'CARD_NOT_OWNED' using errcode = 'P0001';
  end if;

  update public.user_cards
  set folder_id = p_folder_id
  where user_id = auth.uid() and id = any(p_card_instance_ids);

  get diagnostics moved_count = row_count;
  return moved_count;
end;
$$;

revoke all on function public.move_cards_to_folder(uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.move_cards_to_folder(uuid[], uuid)
  to authenticated;
