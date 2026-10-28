begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.card_shares add column is_evolved boolean not null default false;
-- Existing Shiny SSR shares represent the historical evolution variant.
update public.card_shares set is_evolved=true where rarity='SSR' and shiny;
drop index public.card_shares_combination_key;
create unique index card_shares_combination_key on public.card_shares(owner_id,card_id,shiny,is_evolved,show_pseudo);
create or replace function public.create_card_share(p_instance_id uuid, p_show_pseudo boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  snapshot record;
  existing_id text;
  new_id text;
begin
  if player_id is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Serialize creation per player so concurrent requests cannot bypass the daily cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(player_id::text, 0));

  select owned.card_id, owned.is_shiny, owned.is_evolved, card.nom, card.franchise,
    card.rarete_base, coalesce(owned.custom_image_url, card.image_url) as image_url, profile.pseudo
  into snapshot
  from public.user_cards owned
  join public.cards card on card.id = owned.card_id
  join public.user_profiles profile on profile.user_id = owned.user_id
  where owned.id = p_instance_id and owned.user_id = player_id;
  if not found then raise exception 'CARD_NOT_OWNED'; end if;

  -- Retention is per player and runs under the same transaction lock.
  delete from public.card_share_creations
  where owner_id = player_id and created_at < pg_catalog.now() - interval '7 days';

  select share.id into existing_id
  from public.card_shares share
  where share.owner_id = player_id
    and share.card_id = snapshot.card_id
    and share.shiny = snapshot.is_shiny
    and share.is_evolved = snapshot.is_evolved
    and share.show_pseudo = coalesce(p_show_pseudo, false);
  if existing_id is not null then
    -- Refresh only the selected illustration; reusing a link is not a creation.
    update public.card_shares
    set catalogue_image_url = snapshot.image_url
    where id = existing_id and catalogue_image_url is distinct from snapshot.image_url;
    return existing_id;
  end if;

  if (select count(*) from public.card_share_creations creation
      where creation.owner_id = player_id
        and creation.created_at >= pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC') at time zone 'UTC') >= 10
  then
    raise exception 'CARD_SHARE_DAILY_LIMIT';
  end if;

  insert into public.card_shares (
    card_id, owner_id, card_name, franchise, rarity, shiny, is_evolved, show_pseudo,
    catalogue_image_url, display_pseudo
  ) values (
    snapshot.card_id, player_id, snapshot.nom, snapshot.franchise,
    snapshot.rarete_base, snapshot.is_shiny, snapshot.is_evolved, coalesce(p_show_pseudo, false),
    snapshot.image_url, case when coalesce(p_show_pseudo, false) then snapshot.pseudo end
  ) returning id into new_id;
  insert into public.card_share_creations (owner_id) values (player_id);
  return new_id;
end;
$$;
create or replace function public.get_shared_card(p_share_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if p_share_id is null or pg_catalog.length(p_share_id) <> 32
    or p_share_id !~ '^[0-9a-f]{32}$'
  then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
    'cardName', share.card_name,
    'franchise', share.franchise,
    'rarity', share.rarity,
    'shiny', share.shiny,
    'isEvolved', share.is_evolved,
    'catalogueImageUrl', share.catalogue_image_url
  ) || case when share.display_pseudo is null then '{}'::jsonb else
    pg_catalog.jsonb_build_object('pseudo', share.display_pseudo) end
  into result
  from public.card_shares share
  where share.id = p_share_id;
  return result;
end;
$$;
create or replace function public.list_card_shares(p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', share.id, 'cardName', share.card_name, 'rarity', share.rarity,
    'shiny', share.shiny, 'isEvolved', share.is_evolved, 'showPseudo', share.show_pseudo, 'createdAt', share.created_at
  ) order by share.created_at desc, share.id desc)
  from (select * from public.card_shares where owner_id = auth.uid()
    order by created_at desc, id desc limit 50 offset greatest(coalesce(p_offset, 0), 0)
  ) share), '[]'::jsonb);
end;
$$;
-- Add only the presentation flag; retain each function's current ACL and business logic.
-- Assertions prevent silently deploying an incomplete patch if a definition changes.
do $patch$
declare signature text; definition text; patched text;
begin
  foreach signature in array array['public.list_auctions()', 'public.get_auction(uuid)',
    'public.list_auctions_page(jsonb,integer)', 'public.get_profile_active_auctions(uuid,jsonb,integer)',
    'public.prepare_account_deletion_without_billing(uuid)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    patched := replace(definition, '''shiny'',uc.is_shiny', '''shiny'',uc.is_shiny,''isEvolved'',uc.is_evolved');
    if signature in ('public.list_auctions_page(jsonb,integer)', 'public.get_profile_active_auctions(uuid,jsonb,integer)') then
      patched := replace(patched, 'uc.is_shiny', 'uc.is_shiny,uc.is_evolved');
      -- The SELECT alias gains the flag; repair the JSON expression after that substitution.
      patched := replace(patched, '''shiny'',uc.is_shiny,uc.is_evolved,''isEvolved'',uc.is_evolved', '''shiny'',uc.is_shiny,''isEvolved'',uc.is_evolved');
      patched := replace(patched, '''shiny'',a.is_shiny', '''shiny'',a.is_shiny,''isEvolved'',a.is_evolved');
    end if;
    if patched = definition then raise exception 'EVOLUTION_PRESENTATION_PATCH_MISSING: %',signature; end if;
    execute patched;
  end loop;
end; $patch$;

notify pgrst, 'reload schema';
commit;
