-- Owner-approved catalogue correction. Manual recipe, never an automatic migration.
-- Persona: move the existing Igor card into VIDEO GAMES; empty anime binders vanish.
-- Mob Psycho: attach the exact missing title to the existing confirmed license.
-- Fate is deliberately outside this operation, per the owner's latest decision.
begin;
set local lock_timeout='3s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(20261008,1022);
lock table public.cards,public.card_franchises,public.anime_series_settings,
  public.anime_license_source_rules,public.anime_license_aliases,public.anime_license_key_redirects,
  public.catalogue_binder_groups,public.catalogue_binder_group_merges,
  public.binder_favorite_preferences,public.panini_album_favorites,
  public.binder_profile_widgets,public.user_profiles in share row exclusive mode;

do $$ begin
  if not exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled
    and mapping_version='11d454c073cf2c60d31c6d34452ad621501f17875d2d1aa906f6ebb337ed7b88'
    and license_mapping_version in ('71c6fc67af55d11c1a390cdbba4443093498cbda896e43a49bc9a3b074c6291c',
      encode(sha256(convert_to('persona-mob-correction-20261026:v1','UTF8')),'hex'))) then
    raise exception 'PERSONA_MOB_MAPPING_CHANGED'; end if;
  if not exists(select 1 from public.cards where id='4a05bda1-0d64-4bb0-9e48-8e1aa59bb68b'
    and nom='IGOR' and source='manual' and source_id='manual-71cb0d13ba9c828c15a454fc'
    and franchise='Persona 5' and categorie in ('ANIME/MANGA','VIDEO GAMES'))
    or (select array_agg(franchise order by franchise) from public.card_franchises
      where card_id='4a05bda1-0d64-4bb0-9e48-8e1aa59bb68b') is distinct from array['PERSONA 3','Persona 5']::text[]
    then raise exception 'PERSONA_IGOR_CHANGED'; end if;
  if not exists(select 1 from public.anime_license_binders where id='0e81eeec-23bc-5c7a-a941-d376b34c90d1'
    and display_name='Mob Psycho 100') then raise exception 'MOB_TARGET_CHANGED'; end if;
  if exists(select 1 from public.anime_license_source_rules where source_license='Mob Psycho 100 I'
      and binder_id<>'0e81eeec-23bc-5c7a-a941-d376b34c90d1')
    or exists(select 1 from public.anime_license_key_redirects where old_key=
      'source:5d166f7c57a212736437d952fd9720f31999387c9be518824fd2bd1de737bb4b'
      and binder_id<>'0e81eeec-23bc-5c7a-a941-d376b34c90d1')
    or exists(select 1 from public.catalogue_binder_group_merges where old_key in (
      'series:0e81eeec-23bc-5c7a-a941-d376b34c90d1',
      'source:5d166f7c57a212736437d952fd9720f31999387c9be518824fd2bd1de737bb4b'))
    then raise exception 'MOB_OVERRIDE_CHANGED'; end if;
  -- The only anime Persona card is Igor. Refuse to hide a newly added anime cast.
  if exists(select 1 from public.catalogue_binder_links where category='ANIME/MANGA'
    and source_license in ('Persona 5','PERSONA 3')
    and card_id<>'4a05bda1-0d64-4bb0-9e48-8e1aa59bb68b') then raise exception 'PERSONA_CAST_CHANGED'; end if;
  -- None were present in the reviewed data. Do not silently orphan a new saved key.
  if exists(select 1 from public.binder_favorite_preferences where binder_key in (
      'source:a4e4118ef0a592e2caa54d16bff3bd7a20aaca287b1078de072917890e83912f',
      'source:6a38e8fcd144e837831dee3feeb9ab61aaacd68410231f761d1c8905050fb720'))
    or exists(select 1 from public.user_profiles p cross join lateral jsonb_array_elements(p.profile_widgets) w
      cross join lateral jsonb_array_elements_text(w->'entries') e where w->>'category'='ANIME/MANGA'
      and e in ('Persona 5','PERSONA 3','source:a4e4118ef0a592e2caa54d16bff3bd7a20aaca287b1078de072917890e83912f',
        'source:6a38e8fcd144e837831dee3feeb9ab61aaacd68410231f761d1c8905050fb720'))
    or exists(select 1 from public.binder_profile_widgets p cross join lateral jsonb_array_elements(p.widgets) w
      cross join lateral jsonb_array_elements_text(w->'entries') e where w->>'category'='ANIME/MANGA'
      and e in ('Persona 5','PERSONA 3','source:a4e4118ef0a592e2caa54d16bff3bd7a20aaca287b1078de072917890e83912f',
        'source:6a38e8fcd144e837831dee3feeb9ab61aaacd68410231f761d1c8905050fb720'))
    then raise exception 'PERSONA_SAVED_SELECTION_CHANGED'; end if;
end $$;

create temporary table correction_expected_cards on commit drop as
  select id,case when id='4a05bda1-0d64-4bb0-9e48-8e1aa59bb68b'
    then to_jsonb(c)||jsonb_build_object('categorie','VIDEO GAMES') else to_jsonb(c) end expected
  from public.cards c;
create temporary table correction_unrelated_links on commit drop as
  select * from public.catalogue_binder_links where card_id<>'4a05bda1-0d64-4bb0-9e48-8e1aa59bb68b'
    and not(category='ANIME/MANGA' and source_license='Mob Psycho 100 I');
create temporary table correction_expected_mob on commit drop as
  select distinct card_id from public.catalogue_binder_links where category='ANIME/MANGA'
    and (binder_key='series:0e81eeec-23bc-5c7a-a941-d376b34c90d1' or source_license='Mob Psycho 100 I');

update public.cards set categorie='VIDEO GAMES'
  where id='4a05bda1-0d64-4bb0-9e48-8e1aa59bb68b' and categorie='ANIME/MANGA';
insert into public.anime_license_source_rules(source_license,binder_id)
  values('Mob Psycho 100 I','0e81eeec-23bc-5c7a-a941-d376b34c90d1') on conflict(source_license) do nothing;
insert into public.anime_license_aliases(binder_id,alias)
  values('0e81eeec-23bc-5c7a-a941-d376b34c90d1','Mob Psycho 100 I') on conflict do nothing;
insert into public.anime_license_key_redirects(old_key,binder_id)
  values('source:5d166f7c57a212736437d952fd9720f31999387c9be518824fd2bd1de737bb4b',
    '0e81eeec-23bc-5c7a-a941-d376b34c90d1') on conflict(old_key) do nothing;
update public.anime_series_settings set license_mapping_version=
  encode(sha256(convert_to('persona-mob-correction-20261026:v1','UTF8')),'hex') where singleton;

do $$ begin
  if exists(select 1 from correction_expected_cards s full join public.cards c using(id)
    where s.expected is distinct from to_jsonb(c)) then raise exception 'CORRECTION_CARDS_CHANGED'; end if;
  if exists((select * from correction_unrelated_links except select * from public.catalogue_binder_links)
    union all
    (select * from public.catalogue_binder_links where card_id<>'4a05bda1-0d64-4bb0-9e48-8e1aa59bb68b'
      and not(category='ANIME/MANGA' and source_license='Mob Psycho 100 I') except select * from correction_unrelated_links))
    then raise exception 'CORRECTION_UNRELATED_BINDERS_CHANGED'; end if;
  if exists((select card_id from correction_expected_mob except select card_id from public.catalogue_binder_links
      where binder_key='series:0e81eeec-23bc-5c7a-a941-d376b34c90d1') union all
    (select card_id from public.catalogue_binder_links where binder_key='series:0e81eeec-23bc-5c7a-a941-d376b34c90d1'
      except select card_id from correction_expected_mob)) then raise exception 'CORRECTION_MOB_MEMBERSHIP_CHANGED'; end if;
  if exists(select 1 from public.catalogue_binder_links where category='ANIME/MANGA'
    and source_license in ('Persona 5','PERSONA 3','Mob Psycho 100 I')
    and (source_license<>'Mob Psycho 100 I' or binder_key<>'series:0e81eeec-23bc-5c7a-a941-d376b34c90d1'))
    then raise exception 'CORRECTION_OLD_BINDER_REMAINS'; end if;
end $$;
commit;
