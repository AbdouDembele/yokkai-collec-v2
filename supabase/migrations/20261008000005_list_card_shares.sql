begin;

create function public.list_card_shares(p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', share.id, 'cardName', share.card_name, 'rarity', share.rarity,
    'shiny', share.shiny, 'showPseudo', share.show_pseudo, 'createdAt', share.created_at
  ) order by share.created_at desc, share.id desc)
  from (select * from public.card_shares where owner_id = auth.uid()
    order by created_at desc, id desc limit 50 offset greatest(coalesce(p_offset, 0), 0)
  ) share), '[]'::jsonb);
end;
$$;

revoke all on function public.list_card_shares(integer) from public, anon, authenticated;
grant execute on function public.list_card_shares(integer) to authenticated;

commit;
