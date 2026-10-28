import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const quote = value => "'" + value.replaceAll("'", "''") + "'";
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/;
const key = /^(source:[0-9a-f]{64}|series:[0-9a-f-]{36})$/;
const digest = value => createHash("sha256").update(value).digest("hex");

// Offline generation only. The reviewed manifest pins exact identities and card
// sets. Similarity discovery is never used to assign a live card or binder.
export function prepareSmallAnimeBinderMerges(manifest) {
  assert.equal(manifest.version, 1);
  assert.match(manifest.base_mapping_version, /^[a-f0-9]{64}$/);
  const groupIds = new Set(),
    sourceKeys = new Set(),
    mergeKeys = new Set();
  const kept = new Set(manifest.kept_separate.map(b => b.key));
  const groups = [],
    sources = [],
    merges = [];
  for (const g of manifest.groups) {
    assert.match(g.group_id, uuid);
    assert.ok(!groupIds.has(g.group_id));
    groupIds.add(g.group_id);
    assert.ok(g.target.trim() && g.source_binders.length >= 2);
    assert.ok(Number.isSafeInteger(g.expected_total) && g.expected_total > 0);
    assert.match(g.expected_ids_md5, /^[a-f0-9]{32}$/);
    groups.push(
      `(${quote(g.group_id)}::uuid,${quote(g.target)},${g.expected_total},${quote(g.expected_ids_md5)})`
    );
    for (const b of g.source_binders) {
      assert.match(b.key, key);
      assert.ok(!kept.has(b.key) && !sourceKeys.has(b.key));
      sourceKeys.add(b.key);
      assert.ok(Number.isSafeInteger(b.cards) && b.cards > 0);
      assert.match(b.card_ids_md5, /^[a-f0-9]{32}$/);
      sources.push(
        `(${quote(b.key)},${quote(b.name)},${quote(b.category)},${b.cards},${quote(b.card_ids_md5)})`
      );
    }
  }
  assert.ok(groups.length && groups.length <= 200);
  for (const m of manifest.merges) {
    assert.match(m.old_key, key);
    assert.ok(!kept.has(m.old_key) && !mergeKeys.has(m.old_key));
    mergeKeys.add(m.old_key);
    assert.ok(groupIds.has(m.group_id));
    if (m.previous_group_id !== null) assert.match(m.previous_group_id, uuid);
    if (m.old_key.startsWith("source:")) {
      assert.equal(
        m.old_key,
        "source:" + digest(m.category + "\u001f" + m.source_license)
      );
    } else assert.ok(m.category === null && m.source_license === null);
    merges.push(
      `(${quote(m.old_key)},${quote(m.group_id)}::uuid,${m.category === null ? "null" : quote(m.category)},${m.source_license === null ? "null" : quote(m.source_license)},${m.previous_group_id === null ? "null" : quote(m.previous_group_id) + "::uuid"})`
    );
  }
  for (const k of sourceKeys)
    assert.ok(mergeKeys.has(k), "Missing historical identity: " + k);
  const version = digest(JSON.stringify(manifest));
  return `-- Generated offline from data/editorial/small-anime-binder-merges-20261026.json.
-- Run the reviewed Persona/Mob recipe first. Manual operation only; back up first.
begin;
set local lock_timeout='3s';set local statement_timeout='120s';
select pg_advisory_xact_lock(20261008,1022);
lock table public.cards,public.card_franchises,public.anime_series_settings,
 public.catalogue_binder_groups,public.catalogue_binder_group_merges,
 public.binder_favorite_preferences,public.panini_album_favorites,
 public.binder_profile_widgets,public.user_profiles in share row exclusive mode;
do $$ begin
 if not exists(select 1 from public.anime_series_settings where singleton and enabled and license_grouping_enabled
   and mapping_version=${quote(manifest.base_mapping_version)}
   and license_mapping_version=encode(sha256(convert_to('persona-mob-correction-20261026:v1','UTF8')),'hex'))
   then raise exception 'SMALL_BINDER_MAPPING_CHANGED'; end if;
end $$;
create temporary table small_merge_groups(id uuid primary key,name text,expected_count integer,expected_md5 text) on commit drop;
insert into small_merge_groups values ${groups.join(",\n")};
create temporary table small_merge_sources(key text primary key,name text,category text,expected_count integer,expected_md5 text) on commit drop;
insert into small_merge_sources values ${sources.join(",\n")};
create temporary table small_merge_keys(old_key text primary key,group_id uuid,category text,source_license text,previous_group_id uuid) on commit drop;
insert into small_merge_keys values ${merges.join(",\n")};
create temporary table small_merge_current on commit drop as select l.* from public.catalogue_binder_links l
 where l.binder_key in(select key from small_merge_sources);
do $$ begin
 if exists(select 1 from small_merge_sources s left join lateral(
   select count(distinct card_id) n,min(display_name) name,min(category) category,
     md5(string_agg(distinct card_id::text,',' order by card_id::text)) ids from small_merge_current where binder_key=s.key
   ) c on true where c.n<>s.expected_count or c.ids is distinct from s.expected_md5
     or c.name is distinct from s.name or c.category is distinct from s.category)
   then raise exception 'SMALL_BINDER_CARD_SET_CHANGED'; end if;
 if exists(select 1 from small_merge_keys k left join public.catalogue_binder_group_merges m using(old_key)
   where m.group_id is distinct from k.previous_group_id) then raise exception 'SMALL_BINDER_OVERRIDE_CHANGED'; end if;
 if exists(select 1 from small_merge_groups n join public.catalogue_binder_groups old using(id))
   then raise exception 'SMALL_BINDER_ID_ALREADY_EXISTS'; end if;
end $$;
create temporary table small_merge_unrelated on commit drop as select * from public.catalogue_binder_links
 where binder_key not in(select key from small_merge_sources);
create temporary table small_merge_cards on commit drop as select id,to_jsonb(c) snapshot from public.cards c;
insert into public.catalogue_binder_groups(id,display_name,enabled) select id,name,true from small_merge_groups;
insert into public.catalogue_binder_group_merges(old_key,group_id,category,source_license)
 select old_key,group_id,category,source_license from small_merge_keys
 on conflict(old_key) do update set group_id=excluded.group_id,category=excluded.category,source_license=excluded.source_license;
update public.anime_series_settings set license_mapping_version=${quote(version)} where singleton;
do $$ begin
 if exists(select 1 from small_merge_groups g left join lateral(
   select count(distinct card_id) n,md5(string_agg(distinct card_id::text,',' order by card_id::text)) ids
   from public.catalogue_binder_links where binder_key='series:'||g.id::text
 ) c on true where c.n<>g.expected_count or c.ids is distinct from g.expected_md5)
 then raise exception 'SMALL_BINDER_RESULT_CHANGED'; end if;
 if exists(select 1 from small_merge_sources s join public.catalogue_binder_links l on l.binder_key=s.key)
   then raise exception 'SMALL_BINDER_OLD_ID_REMAINS'; end if;
 if exists((select * from small_merge_unrelated except select * from public.catalogue_binder_links) union all
   (select * from public.catalogue_binder_links where binder_key not in(select 'series:'||id::text from small_merge_groups)
     except select * from small_merge_unrelated)) then raise exception 'SMALL_BINDER_UNRELATED_CHANGED'; end if;
 if exists(select 1 from small_merge_cards s full join public.cards c using(id) where s.snapshot is distinct from to_jsonb(c))
   then raise exception 'SMALL_BINDER_SOURCE_CARD_CHANGED'; end if;
end $$;
commit;
`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../data/editorial/small-anime-binder-merges-20261026.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  writeFileSync(
    new URL(
      "../supabase/recipes/merge_small_anime_binders_20261026.sql",
      import.meta.url
    ),
    prepareSmallAnimeBinderMerges(manifest)
  );
  console.log(
    JSON.stringify({
      groups: manifest.groups.length,
      production_modified: false
    })
  );
}
