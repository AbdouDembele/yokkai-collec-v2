-- Owner requested every Dragon Ball Z card to join the existing Dragon Ball binder.
-- This uses the existing editorial layer without rewriting cards or player data.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(20261008,1022);
lock table public.catalogue_binder_groups,public.catalogue_binder_group_merges,
  public.anime_series_settings in share row exclusive mode;

do $$
declare
  target_id constant uuid := '308dee4e-c046-5b13-a089-4b2a83806107';
  prior_id constant uuid := '436a5768-c482-5a8c-a337-71323ad1909a';
begin
  if not exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled
    and mapping_version='11d454c073cf2c60d31c6d34452ad621501f17875d2d1aa906f6ebb337ed7b88'
    and license_mapping_version in ('c3a54b282cd883e7325fee120b7c736f6dbd576fc140aab07b4c0f36508e7490',
      encode(sha256(convert_to('merge-dragon-ball-z-20261025:v1','UTF8')),'hex'))) then
    raise exception 'DRAGON_BALL_MAPPING_CHANGED';
  end if;
  if not exists(select 1 from public.anime_license_binders where id=target_id and display_name='Dragon Ball')
    or not exists(select 1 from public.anime_license_binders where id=prior_id and display_name='Dragon Ball Z') then
    raise exception 'DRAGON_BALL_TARGET_CHANGED';
  end if;
  if exists(select 1 from public.catalogue_binder_groups where id=target_id and (display_name<>'Dragon Ball' or not enabled))
    or exists(select 1 from public.catalogue_binder_groups where id=prior_id) then
    raise exception 'DRAGON_BALL_GROUP_CHANGED';
  end if;
  if exists(select 1 from public.catalogue_binder_group_merges where old_key='series:'||target_id::text
      or (old_key='series:'||prior_id::text and group_id<>target_id)) then
    raise exception 'DRAGON_BALL_EDITORIAL_OVERRIDE_CHANGED';
  end if;
  -- Refuse unexpected source changes on the six titles initially reviewed.
  if exists(select 1 from (values
      ('Dragon Ball Z: The Tree of Might'),('Dragon Ball Z: Resurrection ''F'''),
      ('Dragon Ball Z: Lord Slug'),('Dragon Ball Z: The Return of Cooler'),
      ('Dragon Ball Z: Wrath of the Dragon'),('Dragon Ball Z: Bio-Broly')) f(source_license)
    left join public.anime_license_source_rules r using(source_license)
    where r.binder_id is distinct from prior_id) then
    raise exception 'DRAGON_BALL_SOURCE_RULE_CHANGED';
  end if;
end;
$$;

insert into public.catalogue_binder_groups(id,display_name,enabled)
values('308dee4e-c046-5b13-a089-4b2a83806107','Dragon Ball',true)
on conflict(id) do nothing;
insert into public.catalogue_binder_group_merges(old_key,group_id)
values('series:436a5768-c482-5a8c-a337-71323ad1909a','308dee4e-c046-5b13-a089-4b2a83806107')
on conflict(old_key) do nothing;

update public.anime_series_settings
set license_mapping_version=encode(sha256(convert_to('merge-dragon-ball-z-20261025:v1','UTF8')),'hex')
where singleton;
commit;
