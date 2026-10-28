// Full-catalogue rehearsal, local disposable Docker only. No database URL input.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { parse } from "csv-parse/sync";
import { bootstrapSQL } from "./replay-migrations.mjs";

const { values } = parseArgs({
  options: {
    ...Object.fromEntries(
      [
        "snapshot",
        "mapping",
        "protected-cards",
        "seed",
        "report",
        "license-mapping",
        "license-seed"
      ].map(k => [k, { type: "string" }])
    ),
    keep: { type: "boolean", default: false }
  }
});
for (const k of ["snapshot", "mapping", "protected-cards", "seed", "report"])
  assert(values[k], `Missing --${k}`);
assert.equal(
  Boolean(values["license-mapping"]),
  Boolean(values["license-seed"]),
  "Provide both license preparation files"
);
const read = p => JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const snapshot = read(values.snapshot),
  mapping = read(values.mapping);
assert.equal(mapping.snapshot_at, snapshot.captured_at);
assert.equal(mapping.production_approved, false);
const protectedRows = parse(readFileSync(values["protected-cards"], "utf8"), {
  columns: true,
  bom: true,
  delimiter: ";"
});
assert.equal(protectedRows.length, 1326);
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"]
  }).trim();
const endpoint =
  process.env.DOCKER_HOST ||
  docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
assert.match(
  endpoint,
  /^(?:npipe:\/\/\/\/\.\/pipe\/|unix:\/\/\/)/,
  "Remote Docker forbidden"
);
const container = docker([
  "run",
  "--detach",
  "--network",
  "none",
  "--name",
  "yokkai-binders-" + randomUUID().slice(0, 8),
  "--env",
  "POSTGRES_USER=supabase_admin",
  "--env",
  "POSTGRES_HOST_AUTH_METHOD=trust",
  "--tmpfs",
  "/docker-entrypoint-initdb.d",
  "supabase/postgres:17.6.1.136"
]);
const quote = v => "'" + String(v).replaceAll("'", "''") + "'";
const sql = (statement, database = "binders_review") =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-h",
      "127.0.0.1",
      "-U",
      "supabase_admin",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1"
    ],
    statement
  );
const query = statement =>
  JSON.parse(
    sql(`select coalesce(jsonb_agg(x),'[]'::jsonb) from (${statement}) x`)
  );
const fingerprint = () =>
  Object.fromEntries(
    [
      "cards",
      "card_franchises",
      "card_categories",
      "user_cards",
      "user_profiles",
      "folders",
      "wishlists",
      "panini_album_favorites",
      "binder_favorite_preferences",
      "binder_legacy_favorite_resolutions",
      "binder_profile_widgets",
      "auctions",
      "trade_offers"
    ].map(table => [
      table,
      sql(
        `select md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) from public.${table} t`
      )
    ])
  );
const report = {
  status: "FAIL",
  engine: "PostgreSQL 17.6.1.136",
  network: "none",
  synthetic_players: true,
  production_modified: false,
  snapshot_at: snapshot.captured_at,
  mapping_sha256: createHash("sha256")
    .update(readFileSync(values.mapping))
    .digest("hex"),
  checks: []
};
const started = Date.now();
try {
  for (let i = 0; ; i++) {
    try {
      sql("select 1", "postgres");
      break;
    } catch (error) {
      if (i >= 90) throw error;
      await delay(1000);
    }
  }
  sql(
    "create role postgres login nosuperuser bypassrls createrole; create role anon; create role authenticated; create role service_role bypassrls; create database binders_review owner postgres;",
    "postgres"
  );
  sql("set role postgres;" + bootstrapSQL);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = readdirSync(directory)
    .filter(n => n.endsWith(".sql"))
    .sort();
  sql(
    "set role postgres;" +
      migrations
        .map(n => readFileSync(new URL(n, directory), "utf8"))
        .join("\n")
  );
  report.migrations = migrations.length;
  report.checks.push("PASS complete migration replay");
  const load = (table, rows) => {
    for (let i = 0; i < rows.length; i += 1000)
      sql(
        `set session_replication_role=replica; insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},${quote(JSON.stringify(rows.slice(i, i + 1000)))}::jsonb); set session_replication_role=origin;`
      );
  };
  load(
    "cards",
    snapshot.cards.map(({ links, categories, ...card }) => card)
  );
  load(
    "card_franchises",
    snapshot.cards.flatMap(c => c.links.map(l => ({ card_id: c.id, ...l })))
  );
  load(
    "card_categories",
    snapshot.cards.flatMap(c =>
      c.categories.map(categorie => ({ card_id: c.id, categorie }))
    )
  );
  const owner = "97000000-0000-4000-8000-000000000001";
  sql(
    `insert into auth.users(id,raw_user_meta_data) values('${owner}','{"pseudo":"IsolatedBinderOwner"}'); insert into public.user_cards(user_id,card_id,rarity) values('${owner}','${mapping.assignments[0].card_id}','C'),('${owner}','${mapping.assignments[0].card_id}','R'); insert into public.panini_album_favorites(user_id,license) values('${owner}',${quote(mapping.assignments[0].source_license)});`
  );
  const before = fingerprint();
  sql("set role postgres;" + readFileSync(values.seed, "utf8"));
  assert.equal(sql("select enabled from public.anime_series_settings"), "f");
  assert.deepEqual(fingerprint(), before);
  report.checks.push(
    "PASS inactive seed preserves complete source/player fingerprints"
  );
  sql("update public.anime_series_settings set enabled=true");
  const actual = query(
    "select binder_key,count(distinct card_id)::int total from public.catalogue_binder_links where category='ANIME/MANGA' group by binder_key"
  );
  const assignments = new Map(
    mapping.assignments.map(r => [
      JSON.stringify([r.card_id, r.source_license]),
      r
    ])
  );
  const hash = v => createHash("sha256").update(v).digest("hex");
  const expected = new Map();
  for (const c of snapshot.cards)
    for (const l of c.links) {
      const a = assignments.get(JSON.stringify([c.id, l.franchise]));
      const key = a
        ? "series:" + a.binder_id
        : "source:" + hash(c.categorie + "\x1f" + l.franchise);
      const ids = expected.get(key) ?? new Set();
      ids.add(c.id);
      expected.set(key, ids);
    }
  assert.equal(actual.length, expected.size);
  for (const row of actual)
    assert.equal(row.total, expected.get(row.binder_key)?.size, row.binder_key);
  report.binders = actual.length;
  report.cards = snapshot.cards.length;
  report.checks.push(
    "PASS every binder UUID-set count matches independent mapping projection"
  );
  const protectedIds = new Set(protectedRows.map(r => r.card_id));
  const protectedActual = query(
    `select card_id,source_license,binder_key,display_name from public.catalogue_binder_links where card_id in (${[...protectedIds].map(quote).join(",")})`
  );
  const protectedExpected = snapshot.cards
    .filter(c => protectedIds.has(c.id))
    .flatMap(c =>
      c.links.map(l => ({
        card_id: c.id,
        source_license: l.franchise,
        binder_key: "source:" + hash(c.categorie + "\x1f" + l.franchise),
        display_name: l.franchise
      }))
    );
  const canonical = rows =>
    rows
      .map(r =>
        JSON.stringify([
          r.card_id,
          r.source_license,
          r.binder_key,
          r.display_name
        ])
      )
      .sort();
  assert.deepEqual(canonical(protectedActual), canonical(protectedExpected));
  report.protected_cards = protectedIds.size;
  report.protected_links = protectedActual.length;
  report.checks.push(
    "PASS all 1326 protected cards retain every original display, source link and stable source key"
  );
  const projected = query(
    "select distinct card_id from public.catalogue_binder_links where series_binder_id is not null"
  )
    .map(r => r.card_id)
    .sort();
  assert.deepEqual(
    projected,
    [...new Set(mapping.assignments.map(r => r.card_id))].sort()
  );
  report.projected_cards = projected.length;
  const key = "series:" + mapping.assignments[0].binder_id;
  const rpc = statement =>
    sql(
      `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${owner}',true);${statement};rollback;`
    )
      .split("\n")
      .at(-1);
  let at = Date.now();
  const albums = JSON.parse(
    rpc(
      "select public.get_binder_albums_page(null,'','ANIME/MANGA',false,0,72)"
    )
  );
  report.albums_rpc_ms = Date.now() - at;
  assert.equal(albums.total, actual.length);
  const album = albums.items.find(r => r.binderKey === key);
  assert(album);
  assert.equal(album.owned, 1);
  const cards = JSON.parse(
    rpc(
      `select public.get_binder_cards_page(null,'${key}','','ANIME/MANGA','',false,0,24)`
    )
  );
  assert.equal(cards.binderOwned, 1);
  assert.equal(cards.binderTotal, expected.get(key).size);
  const ownCards = new Set(
    mapping.assignments
      .filter(a => a.binder_id === mapping.assignments[0].binder_id)
      .map(a => a.card_id)
  );
  for (const card of cards.items) assert(ownCards.has(card.id));
  report.checks.push(
    "PASS actual application album/card RPC totals, duplicate-copy progression, source titles and pagination"
  );
  assert.deepEqual(fingerprint(), before);
  sql(
    readFileSync(
      new URL(
        "../supabase/recipes/disable_stable_binders.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.equal(
    sql(
      "select count(*) from public.catalogue_binder_links where series_binder_id is not null"
    ),
    "0"
  );
  assert.deepEqual(fingerprint(), before);
  report.checks.push(
    "PASS logical rollback restores source presentation; no card, collection or player record deleted"
  );
  sql("update public.anime_series_settings set enabled=true");
  assert.equal(
    query("select distinct binder_key from public.catalogue_binder_links")
      .length,
    actual.length
  );
  report.checks.push("PASS reactivation is deterministic");
  if (values["license-mapping"]) {
    const licensed = read(values["license-mapping"]);
    const priorLinks = query(
      "select card_id,source_license,binder_key,display_name from public.catalogue_binder_links"
    );
    sql("set role postgres;" + readFileSync(values["license-seed"], "utf8"));
    assert.deepEqual(fingerprint(), before);
    assert.equal(
      sql("select license_grouping_enabled from public.anime_series_settings"),
      "f"
    );
    sql(
      "update public.anime_series_settings set license_grouping_enabled=true"
    );
    const licensedActual = query(
      "select binder_key,min(display_name) name,array_agg(distinct card_id::text order by card_id::text) ids from public.catalogue_binder_links group by binder_key"
    );
    const licensedExpected = new Map(
      licensed.expected_binders.map(b => [b.binder_key, b])
    );
    assert.equal(licensedActual.length, licensedExpected.size);
    for (const row of licensedActual) {
      const target = licensedExpected.get(row.binder_key);
      assert(target, row.binder_key);
      assert.deepEqual(row.ids, target.cards);
      assert.equal(row.name, target.display_name);
    }
    const sameSource = query(
      "select source_license,count(distinct binder_key)::int targets from public.catalogue_binder_links group by source_license"
    );
    assert(
      sameSource
        .filter(r => r.targets > 1)
        .every(r => r.source_license === "One Piece"),
      "Only the explicitly separated ONE PIECE in LOVE retains a mixed historical source label"
    );
    for (const name of ["Naruto", "Bleach"]) {
      const row = licensedActual.filter(r => r.name === name);
      assert.equal(row.length, 1, name);
      const sourceIds = snapshot.cards
        .filter(c => c.links.some(l => l.franchise === name))
        .map(c => c.id)
        .sort();
      assert.deepEqual(
        row[0].ids,
        sourceIds,
        name +
          " includes every provenance and season under that confirmed source license"
      );
    }
    assert.deepEqual(fingerprint(), before);
    report.license_binders = licensedActual.length;
    report.license_mapping_sha256 = createHash("sha256")
      .update(readFileSync(values["license-mapping"]))
      .digest("hex");
    report.license_examples = licensedActual
      .filter(r =>
        [
          "Naruto",
          "Bleach",
          "Tokyo Ghoul",
          "Tokyo Ghoul:re",
          "One Piece",
          "ONE PIECE in LOVE"
        ].includes(r.name)
      )
      .map(r => ({ name: r.name, total: r.ids.length }));
    report.checks.push(
      "PASS confirmed licenses group all AniList/manual/uncertain cards; exact UUID sets, source titles, memberships and player fingerprints preserved"
    );
    const newAlbums = JSON.parse(
      rpc(
        "select public.get_binder_albums_page(null,'','ANIME/MANGA',false,0,72)"
      )
    );
    assert.equal(newAlbums.total, licensedActual.length);
    const narutoPage = JSON.parse(
      rpc(
        "select public.get_binder_albums_page(null,'Naruto','ANIME/MANGA',false,0,72)"
      )
    );
    assert.equal(
      narutoPage.items.filter(r => r.license === "Naruto").length,
      1
    );
    assert(!narutoPage.items.some(r => r.license === "Naruto: Shippuden"));
    const publicBudgets = {};
    for (const q of ["", "Naruto Shippuden", "Bleach", "%"]) {
      const startedQuery = Date.now();
      const result = JSON.parse(
        sql(
          "begin;set local role anon;set local statement_timeout='3s';select public.get_binder_catalogue_page(" +
            quote(q) +
            ",'ANIME/MANGA','',0,24);rollback;"
        )
      );
      assert(result.total > 0);
      publicBudgets[q || "(empty)"] = {
        total: result.total,
        duration_ms: Date.now() - startedQuery
      };
    }
    report.public_query_budget = publicBudgets;
    // Regression: one legacy favorite hid repeated full-catalogue scans. The
    // affected live account had 51. Keep the real authenticated SQL budget.
    const favoriteBudgets = {};
    for (const [q, favoritesOnly] of [
      ["", false],
      ["Naruto", false],
      ["", true]
    ]) {
      const began = Date.now();
      const result = JSON.parse(
        sql(
          `begin;
        insert into public.panini_album_favorites(user_id,license)
          select '${owner}',franchise from (
            select distinct c.franchise from public.cards c where c.franchise is not null
              and not exists(select 1 from public.panini_album_favorites f where f.user_id='${owner}' and f.license=c.franchise)
            order by c.franchise limit 45
          ) x on conflict do nothing;
        insert into public.panini_album_favorites(user_id,license)
          select '${owner}','Unmatched legacy fixture ' || i from generate_series(1,5) i on conflict do nothing;
        do $$ begin if (select count(*) from public.panini_album_favorites where user_id='${owner}')<>51 then raise exception 'FAVORITE_FIXTURE_INCOMPLETE'; end if;
          perform set_config('request.jwt.claim.sub','${owner}',true); end $$;
        set local role authenticated;
        set local statement_timeout='8s';
        select public.get_binder_albums_page(null,${quote(q)},'',${favoritesOnly},0,72);
        rollback;`
        )
      );
      assert(result.items.length > 0);
      if (!q && !favoritesOnly)
        assert.equal(result.total, licensedActual.length);
      if (q === "Naruto")
        assert(
          result.items.some(i => i.license === "Naruto" && i.total === 453)
        );
      favoriteBudgets[(q || "(empty)") + (favoritesOnly ? ":favorites" : "")] =
        {
          total: result.total,
          duration_ms: Date.now() - began
        };
    }
    assert.deepEqual(fingerprint(), before);
    report.authenticated_51_favorite_budget = favoriteBudgets;
    report.checks.push(
      "PASS unfiltered, searched and favorites-only albums with 51 historical favorites stay within the unchanged authenticated 8-second SQL limit"
    );
    sql(
      "update public.anime_series_settings set license_grouping_enabled=false"
    );
    assert.deepEqual(
      canonical(
        query(
          "select card_id,source_license,binder_key,display_name from public.catalogue_binder_links"
        )
      ),
      canonical(priorLinks)
    );
    assert.deepEqual(fingerprint(), before);
    sql(
      "update public.anime_series_settings set license_grouping_enabled=true"
    );
    assert.equal(
      query("select distinct binder_key from public.catalogue_binder_links")
        .length,
      licensedActual.length
    );
    report.checks.push(
      "PASS license-mode rollback restores exact previous binders; reactivation is deterministic; public requests retain the 3-second budget"
    );
  }
  report.status = "PASS";
  if (values.keep) report.local_container = container;
} catch (error) {
  report.error =
    error.stderr
      ?.toString()
      .split("\n")
      .filter(l => /ERROR|DETAIL|CONTEXT/.test(l))
      .slice(-6)
      .join("\n") || error.message;
  throw error;
} finally {
  report.duration_ms = Date.now() - started;
  writeFileSync(values.report, JSON.stringify(report, null, 2) + "\n");
  if (!values.keep || report.status !== "PASS")
    docker(["rm", "--force", container]);
  console.log(
    JSON.stringify({
      status: report.status,
      cards: report.cards,
      binders: report.binders,
      protected_cards: report.protected_cards,
      duration_ms: report.duration_ms,
      error: report.error
    })
  );
}
