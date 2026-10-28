begin;

create function public.search_cards(p_query text default '',p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=btrim(coalesce(p_query,'')); safe_limit integer:=least(greatest(coalesce(p_limit,30),1),60);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
    'rarity',c.rarete_base,'image',c.image_url
  ) order by
    case when lower(c.nom)=lower(query) then 0 when lower(c.nom) like lower(query)||'%' then 1 else 2 end,
    lower(c.nom),c.id),'[]'::jsonb)
  from (select * from public.cards
    where query='' or nom ilike '%'||query||'%' or franchise ilike '%'||query||'%'
      or categorie ilike '%'||query||'%'
    order by case when lower(nom)=lower(query) then 0 when lower(nom) like lower(query)||'%' then 1 else 2 end,
      lower(nom),id limit safe_limit) c);
end; $$;

revoke all on function public.search_cards(text,integer) from public,anon,authenticated;
grant execute on function public.search_cards(text,integer) to authenticated;

commit;
