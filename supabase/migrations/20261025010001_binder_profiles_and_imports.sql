begin;

-- Resolve only a unique legacy name. An ambiguous entry remains a labelled
-- legacy choice until its owner chooses stable keys; the original JSON survives.
create function public.resolve_binder_widgets(p_widgets jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare widget jsonb; entry jsonb; entry_value text; chosen text; title text; targets integer;
  entries jsonb; labels jsonb; unresolved jsonb; output jsonb := '[]'::jsonb;
begin
  for widget in select value from jsonb_array_elements(coalesce(p_widgets,'[]'::jsonb)) loop
    entries := '[]'::jsonb; labels := '{}'::jsonb; unresolved := '[]'::jsonb;
    for entry in select item from jsonb_array_elements(widget->'entries') item loop
      entry_value := entry #>> '{}'; chosen := null; title := null;
      if entry_value ~ '^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$' then
        select min(l.display_name) into title from public.catalogue_binder_links l
          where l.binder_key=entry_value and upper(btrim(l.category))=widget->>'category';
        chosen := entry_value;
      else
        select count(distinct l.binder_key),min(l.binder_key),min(l.display_name) into targets,chosen,title
          from public.catalogue_binder_links l where upper(btrim(l.category))=widget->>'category'
            and (l.source_license=entry_value or l.display_name=entry_value);
        if targets <> 1 then chosen := entry_value; title := entry_value; unresolved := unresolved || jsonb_build_array(entry_value); end if;
      end if;
      if not entries @> jsonb_build_array(chosen) then entries := entries || jsonb_build_array(chosen); end if;
      labels := labels || jsonb_build_object(chosen,coalesce(title,'Unavailable binder'));
    end loop;
    output := output || jsonb_build_array(jsonb_build_object('category',widget->>'category','entries',entries,
      'labels',labels,'unresolvedEntries',unresolved));
  end loop;
  return output;
end $$;
revoke all on function public.resolve_binder_widgets(jsonb) from public,anon,authenticated,service_role;

create function public.get_profile_binders_page(p_category text,p_query text default '',p_offset integer default 0,p_limit integer default 72)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return (
    with choices as materialized (
      select l.binder_key, min(l.display_name) as license, min(l.origin) as origin
      from public.catalogue_binder_links l where upper(btrim(l.category))=upper(btrim(p_category))
        and (coalesce(p_query,'')='' or l.display_name ilike '%' || btrim(p_query) || '%'
          or l.source_license ilike '%' || btrim(p_query) || '%'
          or exists(select 1 from public.anime_series_aliases a where a.binder_id=l.series_binder_id and a.alias ilike '%' || btrim(p_query) || '%'))
      group by l.binder_key
    ), page as (select * from choices order by license,binder_key offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,72),1),72))
    select jsonb_build_object('items',coalesce((select jsonb_agg(binder_key order by license,binder_key) from page),'[]'::jsonb),
      'labels',coalesce((select jsonb_object_agg(binder_key,license) from page),'{}'::jsonb),
      'origins',coalesce((select jsonb_object_agg(binder_key,origin) from page),'{}'::jsonb),'total',(select count(*) from choices))
  );
end $$;

create function public.set_profile_binder_widgets(p_widgets jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := auth.uid(); widget jsonb; entry jsonb; widget_category text; seen text[] := '{}'; legacy jsonb; existing jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.get_profile(null);
  if jsonb_typeof(p_widgets) is distinct from 'array' or jsonb_array_length(p_widgets)>12 or octet_length(p_widgets::text)>20000 then raise exception 'WIDGETS_INVALID'; end if;
  select profile_widgets into legacy from public.user_profiles where user_id=viewer;
  select widgets into existing from public.binder_profile_widgets where user_id=viewer;
  for widget in select value from jsonb_array_elements(p_widgets) loop
    if jsonb_typeof(widget) is distinct from 'object' or jsonb_typeof(widget->'category') is distinct from 'string'
      or jsonb_typeof(widget->'entries') is distinct from 'array'
      or exists(select 1 from jsonb_object_keys(widget) k where k not in ('category','entries')) then raise exception 'WIDGETS_INVALID'; end if;
    widget_category := widget->>'category';
    if widget_category=any(seen) or jsonb_array_length(widget->'entries')>12
      or not exists(select 1 from public.cards where upper(btrim(categorie))=widget_category)
      or jsonb_array_length(widget->'entries')<>(select count(distinct value) from jsonb_array_elements(widget->'entries')) then raise exception 'WIDGETS_INVALID'; end if;
    seen := array_append(seen,widget_category);
    for entry in select value from jsonb_array_elements(widget->'entries') loop
      if jsonb_typeof(entry) <> 'string' or not (
        exists(select 1 from public.catalogue_binder_links where binder_key=(entry#>>'{}') and upper(btrim(catalogue_binder_links.category))=widget_category)
        or exists(select 1 from jsonb_array_elements(coalesce(legacy,'[]'::jsonb) || coalesce(existing,'[]'::jsonb)) old
          where old->>'category'=widget_category and old->'entries' @> jsonb_build_array(entry))
      ) then raise exception 'WIDGETS_INVALID'; end if;
    end loop;
  end loop;
  insert into public.binder_profile_widgets(user_id,widgets) values(viewer,p_widgets)
    on conflict(user_id) do update set widgets=excluded.widgets;
  return public.resolve_binder_widgets(p_widgets);
end $$;

create function public.get_profile_details_with_binders(p_identifier text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare base jsonb; profile jsonb; owner_id uuid; widgets jsonb; albums jsonb := '[]'::jsonb;
begin
  -- Delegate all existing profile visibility, block and ban decisions unchanged.
  base := public.get_profile_details(p_identifier);
  profile := public.get_profile(p_identifier); owner_id := (profile->>'id')::uuid;
  select coalesce((select w.widgets from public.binder_profile_widgets w where w.user_id=owner_id),
    (select u.profile_widgets from public.user_profiles u where u.user_id=owner_id)) into widgets;
  if (profile->>'canViewCollection')::boolean then
    with favorites as materialized (select binder_key from public.binder_favorite_keys(owner_id)),
    owned as materialized (select distinct card_id from public.user_cards where user_id=owner_id),
    progress as (
      select l.binder_key,min(l.display_name) as license,min(l.origin) as origin,
        count(distinct l.card_id) as total,count(distinct owned.card_id) as owned
      from public.catalogue_binder_links l join favorites f on f.binder_key=l.binder_key
      left join owned on owned.card_id=l.card_id group by l.binder_key
    ) select coalesce(jsonb_agg(jsonb_build_object('binderKey',binder_key,'license',license,'origin',origin,'total',total,
      'owned',owned,'percent',least(100,round(owned::numeric*100/nullif(total,0)))) order by license,binder_key),'[]'::jsonb) into albums from progress;
  end if;
  return base || jsonb_build_object('widgets',public.resolve_binder_widgets(widgets),'favoriteAlbums',albums);
end $$;

revoke all on function public.get_profile_binders_page(text,text,integer,integer),public.set_profile_binder_widgets(jsonb),
  public.get_profile_details_with_binders(text) from public,anon,authenticated,service_role;
grant execute on function public.get_profile_binders_page(text,text,integer,integer),public.set_profile_binder_widgets(jsonb),
  public.get_profile_details_with_binders(text) to authenticated;

-- Only this service-role import path preserves unnormalised received titles.
-- All existing manual/admin normalization and secondary-link behavior remains.
create or replace function public.normalize_card_franchise_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.franchise := nullif(btrim(new.franchise),'');
  if current_setting('yokkai.anilist_source_import',true)='on' and new.source='anilist' and new.categorie='ANIME/MANGA' then return new; end if;
  new.franchise := case when upper(btrim(new.categorie))='ANIME/MANGA' then public.normalize_anime_franchise(new.franchise)
    else public.normalize_card_franchise(new.franchise) end;
  return new;
end $$;
revoke all on function public.normalize_card_franchise_before_write() from public,anon,authenticated;

create function public.import_anilist_cards(p_rows jsonb,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item jsonb; card public.cards; mid integer; cid integer; proof text; source_title text; romaji text;
  result jsonb := '[]'::jsonb; prior text := current_setting('yokkai.anilist_source_import',true); safe_rule integer;
begin
  if p_batch_id is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>200 then raise exception 'ANILIST_IMPORT_INVALID'; end if;
  perform set_config('yokkai.anilist_source_import','on',true);
  for item in select value from jsonb_array_elements(p_rows) loop
    if item->>'source' is distinct from 'anilist' or item->>'categorie' is distinct from 'ANIME/MANGA'
      or coalesce(item->>'source_id','') !~ '^[1-9][0-9]{0,8}$' or coalesce(btrim(item->>'nom'),'')=''
      or coalesce(item->>'rarete_base','') not in ('C','R','SR','SSR','LR')
      or coalesce(item->>'image_url','') !~ '^https://[^[:space:]]+' then raise exception 'ANILIST_IMPORT_INVALID'; end if;
    cid := (item->>'source_id')::integer;
    mid := case when coalesce(item->>'anilist_media_id','') ~ '^[1-9][0-9]{0,8}$' then (item->>'anilist_media_id')::integer else null end;
    source_title := nullif(btrim(item->>'franchise'),''); romaji := nullif(btrim(item->>'franchise_romaji'),'');
    -- The digest binds this character, media and the exact received titles.
    proof := encode(sha256(convert_to(jsonb_build_array('anilist',cid,mid,source_title,romaji)::text,'UTF8')),'hex');
    insert into public.cards(source,source_id,nom,categorie,franchise,franchise_romaji,rarete_base,image_url,favoris_count)
    values('anilist',cid::text,btrim(item->>'nom'),'ANIME/MANGA',source_title,romaji,(item->>'rarete_base')::public.card_rarity,
      item->>'image_url',greatest(coalesce((item->>'favoris_count')::integer,0),0))
    on conflict(source,source_id) do nothing returning * into card;
    if card.id is null then
      result := result || jsonb_build_array(jsonb_build_object('source_id',cid::text,'status','EXISTING_UNCHANGED')); continue;
    end if;
    safe_rule := null;
    if mid is not null and item->>'anilist_proof_version'='anilist-import-v1' and item->>'anilist_evidence_sha256'=proof then
      select media_id into safe_rule from public.anime_series_media_rules where media_id=mid and decision='A' and editorial_approved;
    end if;
    if safe_rule is not null and source_title is not null and not exists(select 1 from public.anime_series_protected_cards where card_id=card.id) then
      insert into public.anime_series_origin_evidence(card_id,character_id,media_id,verified_snapshot,import_evidence_sha256,import_batch_id)
        values(card.id,cid,mid,to_jsonb(card),proof,p_batch_id);
      insert into public.anime_series_card_assignments(card_id,source_license,media_id) values(card.id,source_title,mid);
      result := result || jsonb_build_array(jsonb_build_object('source_id',cid::text,'card_id',card.id,'status','ASSIGNED_APPROVED_MEDIA'));
    else
      insert into public.anilist_import_review(card_id,media_id,batch_id,reason) values(card.id,mid,p_batch_id,
        case when mid is null then 'MEDIA_PROVENANCE_MISSING' when safe_rule is null then 'MEDIA_UNAPPROVED_OR_PROOF_INVALID' else 'SOURCE_TITLE_MISSING' end);
      result := result || jsonb_build_array(jsonb_build_object('source_id',cid::text,'card_id',card.id,'status','SOURCE_ONLY_REVIEW_REQUIRED'));
    end if;
  end loop;
  perform set_config('yokkai.anilist_source_import',coalesce(prior,''),true);
  return result;
end $$;
revoke all on function public.import_anilist_cards(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.import_anilist_cards(jsonb,uuid) to service_role;

commit;

