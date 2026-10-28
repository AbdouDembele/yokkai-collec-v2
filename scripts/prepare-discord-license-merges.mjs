import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Offline preparation only. This script never connects to a database.
export function prepareDiscordLicenseMerges(mapping) {
  assert.equal(mapping.version, 1);
  assert.equal(mapping.production_applied, false);
  assert.equal(mapping.deletion.approved_in_request, true);
  assert.equal(mapping.deletion.cards.length, 4);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const groups = [],
    merges = [],
    seen = new Set();
  for (const g of mapping.groups) {
    assert.match(g.group_id, /^[0-9a-f-]{36}$/);
    assert(g.target.trim() && g.sources.length >= 2);
    if (!g.already_grouped)
      assert(
        !g.current_binder_keys.includes("series:" + g.group_id),
        "A new merge needs a new preference identity"
      );
    groups.push(`(${quote(g.group_id)}::uuid,${quote(g.target)},true)`);
    for (const key of g.merge_keys) {
      assert.match(key, /^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$/);
      assert(!seen.has(key), "Overlapping binder: " + key);
      seen.add(key);
      const source = g.sources.find(
        s =>
          "source:" +
            createHash("sha256")
              .update(s.category + "\u001f" + s.license)
              .digest("hex") ===
          key
      );
      assert(
        key.startsWith("series:") || source,
        "Missing indexed source metadata: " + key
      );
      merges.push(
        `(${quote(key)},${quote(g.group_id)}::uuid,${source ? quote(source.category) : "null"},${source ? quote(source.license) : "null"})`
      );
    }
  }
  for (const excluded of mapping.excluded_binder_groups ?? [])
    for (const key of excluded.merge_keys)
      assert(!seen.has(key), "Excluded binder must remain unchanged: " + key);
  for (const card of mapping.deletion.cards)
    assert.match(card.id, /^[0-9a-f-]{36}$/);
  for (const id of mapping.deletion.expected_copy_ids)
    assert.match(id, /^[0-9a-f-]{36}$/);
  const ids = mapping.deletion.cards.map(c => quote(c.id)).join(",");
  const copyIds = mapping.deletion.expected_copy_ids.map(quote).join(",");
  const license = quote(mapping.deletion.license),
    category = quote(mapping.deletion.category);
  const version = createHash("sha256")
    .update(JSON.stringify(mapping))
    .digest("hex");
  return `-- Generated offline; review docs/discord-license-merges-2026-10-25.md first.
-- Requires migration 20261025170000_editorial_binder_merges. No automatic application.
-- Back up PostgreSQL and validate the backup before applying. Storage is preserved.
begin;
set local lock_timeout='5s';
set local statement_timeout='5min';
lock table public.cards,public.card_franchises,public.anime_series_settings,
  public.catalogue_binder_groups,public.catalogue_binder_group_merges,
  public.panini_album_favorites,public.binder_favorite_preferences,
  public.user_profiles,public.binder_profile_widgets in share row exclusive mode;

do $$ begin
  if not exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled
    and mapping_version=${quote(mapping.active_projection.mapping_version)}
    and license_mapping_version in (${quote(mapping.active_projection.license_mapping_version)},${quote(version)})) then
    raise exception 'DISCORD_MERGE_PROJECTION_CHANGED';
  end if;
end $$;

create temporary table discord_reviewed_groups(id uuid primary key,display_name text,enabled boolean) on commit drop;
insert into discord_reviewed_groups values
${groups.join(",\n")};
create temporary table discord_reviewed_merges(old_key text primary key,group_id uuid,category text,source_license text) on commit drop;
insert into discord_reviewed_merges values
${merges.join(",\n")};
do $$ begin
  if exists(select 1 from discord_reviewed_merges n join public.catalogue_binder_group_merges old using(old_key)
    where old.group_id<>n.group_id) then raise exception 'DISCORD_MERGE_CONFIGURATION_CHANGED'; end if;
end $$;

-- No card source fields, memberships, proofs or saved merge preferences change.
insert into public.catalogue_binder_groups select * from discord_reviewed_groups
on conflict(id) do update set display_name=excluded.display_name,enabled=excluded.enabled;
insert into public.catalogue_binder_group_merges select * from discord_reviewed_merges
on conflict(old_key) do update set category=excluded.category,source_license=excluded.source_license;

-- Sonico: fail closed if any audited card or owned-copy identity changes.
create temporary table discord_delete_cards(id uuid primary key) on commit drop;
insert into discord_delete_cards select c.id from public.cards c
where c.id=any(array[${ids}]::uuid[]) or c.franchise=${license}
  or exists(select 1 from public.card_franchises f where f.card_id=c.id and f.franchise=${license})
for update of c;
do $$ declare target uuid; begin
  if exists(select 1 from discord_delete_cards) then
    if (select array_agg(id order by id) from discord_delete_cards) is distinct from
      (select array_agg(x order by x) from unnest(array[${ids}]::uuid[]) x)
      or exists(select 1 from discord_delete_cards t join public.cards c on c.id=t.id
        where c.categorie is distinct from ${category} or c.franchise is distinct from ${license})
      or exists(select 1 from discord_delete_cards t join public.card_franchises f on f.card_id=t.id where f.franchise<>${license}) then
      raise exception 'DISCORD_SONICO_CARD_SET_CHANGED';
    end if;
    perform id from public.user_cards where card_id in(select id from discord_delete_cards) order by id for update;
    if exists(select 1 from public.user_cards where card_id in(select id from discord_delete_cards)
      and (not(id=any(array[${copyIds}]::uuid[])) or is_locked))
      or exists(select 1 from public.auctions where status='active' and card_instance_id in(select id from public.user_cards where card_id in(select id from discord_delete_cards)))
      or exists(select 1 from public.trade_offers where status='pending' and
        (offered_card_ids && array(select id from public.user_cards where card_id in(select id from discord_delete_cards))
        or requested_card_ids && array(select id from public.user_cards where card_id in(select id from discord_delete_cards))))
      or exists(select 1 from public.wishlists where card_id in(select id from discord_delete_cards))
      or exists(select 1 from public.decision_pack_choices where card_id in(select id from discord_delete_cards))
      or exists(select 1 from public.card_shares where card_id in(select id from discord_delete_cards))
      or exists(select 1 from public.user_profiles where banner_card_id in(select id from discord_delete_cards))
      or exists(select 1 from public.anime_series_origin_evidence where card_id in(select id from discord_delete_cards)) then
      raise exception 'DISCORD_SONICO_PLAYER_REFERENCES_CHANGED';
    end if;
    for target in select id from discord_delete_cards order by id loop
      perform public.admin_delete_card_core(target);
    end loop;
  end if;
end $$;
delete from public.panini_album_favorites where license=${license}
  and not exists(select 1 from public.card_franchises where franchise=${license});
delete from public.binder_favorite_preferences where binder_key=
  'source:' || encode(sha256(convert_to(${category} || chr(31) || ${license},'UTF8')),'hex');

-- Only remove Sonico widget choices. All entries involved in merges are kept
-- byte-for-byte and resolve to the canonical binder when read by existing RPCs.
create function pg_temp.discord_remove_sonico(widgets jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(w.value || jsonb_build_object('entries',(
    select coalesce(jsonb_agg(to_jsonb(e.value) order by e.position),'[]'::jsonb)
    from jsonb_array_elements_text(w.value->'entries') with ordinality e(value,position)
    where not(w.value->>'category'=${category} and e.value in (${license},
      'source:' || encode(sha256(convert_to(${category} || chr(31) || ${license},'UTF8')),'hex')))
  )) order by w.position),'[]'::jsonb) from jsonb_array_elements(widgets) with ordinality w(value,position)
$$;
update public.user_profiles set profile_widgets=pg_temp.discord_remove_sonico(profile_widgets)
where profile_widgets is distinct from pg_temp.discord_remove_sonico(profile_widgets);
update public.binder_profile_widgets set widgets=pg_temp.discord_remove_sonico(widgets)
where widgets is distinct from pg_temp.discord_remove_sonico(widgets);
drop function pg_temp.discord_remove_sonico(jsonb);
update public.anime_series_settings set license_mapping_version=${quote(version)} where singleton;
commit;
`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const mapping = JSON.parse(
    readFileSync(
      new URL(
        "../data/editorial/discord-license-merges-2026-10-25.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  writeFileSync(
    new URL(
      "../supabase/recipes/merge_discord_licenses_20261025.sql",
      import.meta.url
    ),
    prepareDiscordLicenseMerges(mapping)
  );
  console.log(
    JSON.stringify({
      status: "PREPARED_ONLY",
      groups: mapping.groups.length,
      production_modified: false
    })
  );
}
