// Only a disposable local Docker database. Never accepts a database URL.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { bootstrapSQL } from "./replay-migrations.mjs";
import { sha256 } from "./anime-series-provenance.mjs";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string" },
    mapping: { type: "string" },
    report: { type: "string" },
    "protected-cards": { type: "string" }
  }
});
for (const name of ["snapshot", "mapping", "report"])
  if (!values[name]) throw new Error(`Missing --${name}`);
const read = path =>
  JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const snapshot = read(values.snapshot),
  mapping = read(values.mapping);
assert.equal(mapping.snapshot_at, snapshot.captured_at);
assert.equal(mapping.production_approved, false);
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"]
  }).trim();
const endpoint =
  process.env.DOCKER_HOST ||
  docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
assert.match(
  endpoint,
  /^(?:npipe:\/\/\/\/\.\/pipe\/|unix:\/\/\/)/,
  "Remote Docker is forbidden"
);
const container = docker([
  "run",
  "--detach",
  "--network",
  "none",
  "--name",
  "yokkai-series-review-" + randomUUID().slice(0, 8),
  "--env",
  "POSTGRES_USER=supabase_admin",
  "--env",
  "POSTGRES_HOST_AUTH_METHOD=trust",
  "--tmpfs",
  "/docker-entrypoint-initdb.d",
  "supabase/postgres:17.6.1.136"
]);
assert.match(container, /^[0-9a-f]{64}$/);
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sql = (statement, database = "anime_series_review") =>
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
const fingerprints = () =>
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
    engine: "PostgreSQL 17 / isolated local Docker",
    network: "none",
    synthetic_players: true,
    snapshot_at: snapshot.captured_at,
    checks: []
  },
  started = Date.now();
try {
  for (let i = 0; ; i++) {
    try {
      // The initdb temporary server exposes a socket only. The explicit loopback
      // TCP connection above waits for the final server, including wrapper images.
      sql("select 1", "postgres");
      break;
    } catch (error) {
      if (i >= 90) throw error;
      await delay(1000);
    }
  }
  sql(
    "create role postgres login nosuperuser bypassrls createrole; create role anon; create role authenticated; create role service_role bypassrls; create database anime_series_review owner postgres;",
    "postgres"
  );
  sql(`set role postgres; ${bootstrapSQL}`);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter(name => name.endsWith(".sql"))
    .sort())
    sql(
      `set role postgres; ${readFileSync(new URL(name, migrations), "utf8")}`
    );
  // Exact local snapshot loading; no trigger-driven normalization of imported fixtures.
  for (let offset = 0; offset < snapshot.cards.length; offset += 1000) {
    const rows = snapshot.cards
      .slice(offset, offset + 1000)
      .map(card =>
        Object.fromEntries(
          Object.entries(card).filter(
            ([key]) => !["links", "categories"].includes(key)
          )
        )
      );
    sql(
      `set session_replication_role=replica; insert into public.cards select * from jsonb_populate_recordset(null::public.cards,${quote(JSON.stringify(rows))}::jsonb); set session_replication_role=origin;`
    );
  }
  const links = snapshot.cards.flatMap(card =>
    card.links.map(link => ({ card_id: card.id, ...link }))
  );
  const categories = snapshot.cards.flatMap(card =>
    card.categories.map(categorie => ({ card_id: card.id, categorie }))
  );
  for (const [table, rows] of [
    ["card_franchises", links],
    ["card_categories", categories]
  ])
    for (let offset = 0; offset < rows.length; offset += 2000)
      sql(
        `set session_replication_role=replica; insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},${quote(JSON.stringify(rows.slice(offset, offset + 2000)))}::jsonb); set session_replication_role=origin;`
      );
  console.log(
    JSON.stringify({
      loaded_anime_cards: snapshot.cards.length,
      original_links: links.length
    })
  );
  const animeIds = new Set(snapshot.cards.map(card => card.id));
  const otherIds = [];
  for (const [index, category] of snapshot.all_category_counts
    .filter(row => row.categorie !== "ANIME/MANGA")
    .entries()) {
    const id = `96000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    otherIds.push(id);
    sql(
      `insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values(${quote(id)},${quote(id)},'OUTSIDE CATEGORY FIXTURE',${quote(category.categorie)},'Tokyo Ghoul √A','C','https://example.test/fixture.png','manual')`
    );
  }
  const owner = "97000000-0000-4000-8000-000000000001";
  const ownedId = mapping.assignments[0]?.card_id ?? snapshot.cards[0].id;
  sql(
    `insert into auth.users(id,raw_user_meta_data) values(${quote(owner)},'{"pseudo":"IsolatedSeriesOwner"}'); insert into public.user_cards(user_id,card_id,rarity,is_shiny) values(${quote(owner)},${quote(ownedId)},'LR',true),(${quote(owner)},${quote(ownedId)},'C',false); insert into public.wishlists(user_id,card_id) values(${quote(owner)},${quote(snapshot.cards[1].id)}); insert into public.panini_album_favorites(user_id,license) values(${quote(owner)},'Tokyo Ghoul √A')`
  );
  const before = fingerprints();
  sql(
    `set role postgres; ${readFileSync(new URL("../supabase/recipes/anime_series_projection.sql", import.meta.url), "utf8")}`
  );
  assert.deepEqual(fingerprints(), before);
  report.checks.push(
    "PASS recipe installation preserves complete catalogue rows, source links and all synthetic player tables"
  );
  const rules = mapping.media_rules.filter(row => row.decision === "A"),
    binders = [
      ...new Map(
        rules.map(row => [
          row.binder_id,
          {
            id: row.binder_id,
            series_media_id: row.series_media_id,
            display_name: row.display_name
          }
        ])
      ).values()
    ];
  sql(
    `insert into public.anime_series_binders select * from jsonb_populate_recordset(null::public.anime_series_binders,${quote(JSON.stringify(binders))}::jsonb)`
  );
  sql(
    `insert into public.anime_series_media_rules select media_id,binder_id,decision,false from jsonb_to_recordset(${quote(JSON.stringify(rules))}::jsonb) x(media_id integer,binder_id uuid,decision text)`
  );
  for (let offset = 0; offset < mapping.assignments.length; offset += 2000) {
    const rows = mapping.assignments.slice(offset, offset + 2000);
    sql(
      `insert into public.anime_series_origin_evidence(card_id,character_id,media_id,verified_snapshot,import_evidence_sha256) select card_id,character_id,media_id,verified_snapshot,import_evidence_sha256 from jsonb_to_recordset(${quote(JSON.stringify(rows))}::jsonb) x(card_id uuid,character_id integer,media_id integer,verified_snapshot jsonb,import_evidence_sha256 text)`
    );
    sql(
      `insert into public.anime_series_card_assignments select card_id,source_license,media_id from jsonb_to_recordset(${quote(JSON.stringify(rows))}::jsonb) x(card_id uuid,source_license text,media_id integer)`
    );
  }
  sql("update public.anime_series_settings set enabled=true");
  assert.equal(
    Number(
      sql(
        "select count(*) from public.anime_series_projected_links where series_binder_id is not null"
      )
    ),
    0
  );
  report.checks.push(
    "PASS unapproved proposed rules cannot project any card even with local feature enabled"
  );
  // Isolated simulation only; the proposal file and production remain unapproved.
  sql(
    "update public.anime_series_media_rules set editorial_approved=true where decision='A'"
  );
  const assignments = new Map(
    mapping.assignments.map(row => [
      JSON.stringify([row.card_id, row.source_license]),
      row
    ])
  );
  const expected = new Map();
  for (const card of snapshot.cards)
    for (const link of card.links) {
      const assignment = assignments.get(
        JSON.stringify([card.id, link.franchise])
      );
      const key = assignment
        ? `series:${assignment.binder_id}`
        : `source:${sha256(card.categorie + String.fromCharCode(31) + link.franchise)}`;
      const set = expected.get(key) ?? new Set();
      set.add(card.id);
      expected.set(key, set);
    }
  const actual = query(
    "select binder_key,count(distinct card_id)::integer total from public.anime_series_projected_links where category='ANIME/MANGA' group by binder_key"
  );
  assert.equal(actual.length, expected.size);
  for (const row of actual)
    assert.equal(row.total, expected.get(row.binder_key)?.size, row.binder_key);
  report.checks.push(
    "PASS independent UUID-set counts for every proposed binder in the full current Anime/Manga catalogue"
  );
  const projectedIds = query(
    "select distinct card_id from public.anime_series_projected_links where series_binder_id is not null"
  ).map(row => row.card_id);
  assert.deepEqual(
    projectedIds.toSorted(),
    [...new Set(mapping.assignments.map(row => row.card_id))].toSorted()
  );
  const snapshotById = new Map(snapshot.cards.map(card => [card.id, card]));
  for (const id of projectedIds)
    assert.ok(
      animeIds.has(id) &&
        assignments.has(JSON.stringify([id, snapshotById.get(id).franchise]))
    );
  const manualOrUnknown = new Set(
    snapshot.cards
      .filter(card => card.source !== "anilist")
      .map(card => card.id)
  );
  for (const id of projectedIds) assert.ok(!manualOrUnknown.has(id));
  if (values["protected-cards"]) {
    const protectedIds = new Set(
      parse(readFileSync(values["protected-cards"], "utf8"), {
        columns: true,
        bom: true,
        delimiter: ";"
      }).map(row => row.card_id)
    );
    for (const id of protectedIds)
      assert.ok(
        animeIds.has(id),
        "Protected ID must exist in the independent snapshot"
      );
    for (const id of projectedIds)
      assert.ok(
        !protectedIds.has(id),
        "Protected imported or manual card must never project"
      );
    const protectedActual = query(
      `select card_id,source_license,binder_key,display_name from public.anime_series_projected_links where card_id in (${[...protectedIds].map(quote).join(",")})`
    );
    const protectedExpected = snapshot.cards
      .filter(card => protectedIds.has(card.id))
      .flatMap(card =>
        card.links.map(link => ({
          card_id: card.id,
          source_license: link.franchise,
          binder_key: `source:${sha256(card.categorie + String.fromCharCode(31) + link.franchise)}`,
          display_name: link.franchise
        }))
      );
    const canonicalRows = rows =>
      rows
        .map(row =>
          JSON.stringify([
            row.card_id,
            row.source_license,
            row.binder_key,
            row.display_name
          ])
        )
        .toSorted();
    assert.deepEqual(
      canonicalRows(protectedActual),
      canonicalRows(protectedExpected)
    );
    report.protected_cards_exact_display_verified = protectedIds.size;
    report.checks.push(
      "PASS every independently supplied protected card retains every exact display name, source link and binder key"
    );
  }
  for (const id of otherIds)
    assert.equal(
      Number(
        sql(
          `select count(*) from public.anime_series_projected_links where card_id=${quote(id)} and series_binder_id is not null`
        )
      ),
      0
    );
  assert.deepEqual(fingerprints(), before);
  report.checks.push(
    "PASS protected source groups, multiple source links, all exact card metadata and every other category remain untouched"
  );
  const progress = query(
    `select binder_key,count(distinct l.card_id)::integer owned from public.anime_series_projected_links l join public.user_cards u on u.card_id=l.card_id where u.user_id=${quote(owner)} group by binder_key`
  );
  for (const row of progress) assert.equal(row.owned, 1);
  report.checks.push(
    "PASS owned progress counts card identities rather than duplicate copies or rarities"
  );
  sql(
    readFileSync(
      new URL(
        "../supabase/recipes/disable_anime_series_projection.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.equal(
    Number(
      sql(
        "select count(*) from public.anime_series_projected_links where series_binder_id is not null"
      )
    ),
    0
  );
  assert.deepEqual(fingerprints(), before);
  report.checks.push(
    "PASS rollback restores source presentation without overwriting any catalogue or player record"
  );
  report.status = "PASS";
  report.anime_cards = snapshot.cards.length;
  report.manual_cards = snapshot.cards.filter(
    card => card.source === "manual"
  ).length;
  report.original_links = links.length;
  report.proposed_binders = actual.length;
  report.projected_cards = projectedIds.length;
  report.outside_categories_tested = otherIds.length;
} catch (error) {
  report.error =
    error.stderr
      ?.toString()
      .split("\n")
      .filter(line => /ERROR|DETAIL|CONTEXT/.test(line))
      .slice(-6)
      .join("\n") || error.message;
  process.exitCode = 1;
} finally {
  report.elapsed_seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(values.report, JSON.stringify(report, null, 2) + "\n");
  docker(["rm", "--force", container]);
  console.log(JSON.stringify(report, null, 2));
}
