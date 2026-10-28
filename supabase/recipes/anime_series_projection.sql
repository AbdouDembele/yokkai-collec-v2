-- LOCAL REHEARSAL ONLY. Not in migrations/ and not wired to production RPCs.
-- No seed, activation or player-preference mutation is included.
begin;
do $$ begin
 if to_regclass('public.global_binder_settings') is not null then
  raise exception 'ANIME_SERIES_PREVIOUS_PROJECTION_PRESENT';
 end if;
end $$;
-- Reusable on a disposable database that already replays the integration.
-- Never relax that integration's private-table grants or existing settings.
create table if not exists public.anime_series_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into public.anime_series_settings(singleton,enabled) values(true,false) on conflict(singleton) do nothing;
create table if not exists public.anime_series_binders (
 id uuid primary key,
 series_media_id integer not null unique check(series_media_id>0),
 display_name text not null check(btrim(display_name)<>'' and char_length(display_name)<=200)
);
create table if not exists public.anime_series_media_rules (
 media_id integer primary key check(media_id>0),
 binder_id uuid not null references public.anime_series_binders(id),
 decision text not null check(decision in ('A','B','C','D')),
 editorial_approved boolean not null default false,
 check(not editorial_approved or decision='A')
);
create table if not exists public.anime_series_origin_evidence (
 card_id uuid primary key references public.cards(id),
 character_id integer not null check(character_id>0),
 media_id integer not null check(media_id>0),
 verified_snapshot jsonb not null,
 import_evidence_sha256 text not null check(import_evidence_sha256~'^[0-9a-f]{64}$'),
 check(verified_snapshot->>'source'='anilist'),
 check(verified_snapshot->>'categorie'='ANIME/MANGA'),
 check(verified_snapshot->>'id'=card_id::text),
 check(verified_snapshot->>'source_id'=character_id::text)
);
create table if not exists public.anime_series_card_assignments (
 card_id uuid not null references public.anime_series_origin_evidence(card_id),
 source_license text not null check(btrim(source_license)<>''),
 media_id integer not null references public.anime_series_media_rules(media_id),
 primary key(card_id,source_license)
);
do $$ declare relation text; begin
 if to_regclass('public.catalogue_binder_links') is not null then
  return; -- Existing integration tables stay private, including catalogue proofs.
 end if;
 foreach relation in array array['anime_series_settings','anime_series_binders','anime_series_media_rules','anime_series_origin_evidence','anime_series_card_assignments'] loop
  execute format('alter table public.%I enable row level security',relation);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',relation);
  execute format('grant select on public.%I to anon,authenticated,service_role',relation);
  execute format('create policy %I on public.%I for select to anon,authenticated,service_role using(true)',relation||'_read',relation);
 end loop;
end $$;

-- Exact per-card provenance, exact source link and exact approved media rule.
-- A name, numeric ID or shared franchise never grants a projection.
create view public.anime_series_projected_links with(security_invoker=true) as
select distinct l.card_id,c.categorie as category,l.franchise as source_license,
 case when eligible.id is not null then 'series:'||eligible.id::text
   else 'source:'||encode(sha256(convert_to(c.categorie||chr(31)||l.franchise,'UTF8')),'hex') end as binder_key,
 coalesce(eligible.display_name,l.franchise) as display_name,
 eligible.id as series_binder_id
from public.card_franchises l join public.cards c on c.id=l.card_id
left join lateral (
 select b.id,b.display_name from public.anime_series_card_assignments a
 join public.anime_series_origin_evidence e on e.card_id=a.card_id and e.media_id=a.media_id
 join public.anime_series_media_rules r on r.media_id=a.media_id and r.decision='A' and r.editorial_approved
 join public.anime_series_binders b on b.id=r.binder_id
 join public.anime_series_settings s on s.singleton and s.enabled
 where a.card_id=c.id and a.source_license=l.franchise and c.source='anilist'
   and c.categorie='ANIME/MANGA' and c.source_id=e.character_id::text
   and e.verified_snapshot=to_jsonb(c)
) eligible on true;
revoke all on public.anime_series_projected_links from public,anon,authenticated,service_role;
do $$ begin
 if to_regclass('public.catalogue_binder_links') is null then
  grant select on public.anime_series_projected_links to anon,authenticated,service_role;
 end if;
end $$;
commit;
