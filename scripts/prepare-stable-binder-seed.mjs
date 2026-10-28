// Prepare a private, reviewable seed. This script never connects to a database.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";

export function prepareSeed(mapping, protectedRows, aliases, receipt, digest) {
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(
    receipt.mapping_sha256,
    digest,
    "Approval must identify these exact immutable bytes"
  );
  assert.equal(receipt.editorial_approved, true);
  assert.equal(
    receipt.production_approved,
    false,
    "Production activation is a separate authorized operation"
  );
  assert.equal(mapping.production_approved, false);
  assert.equal(new Set(protectedRows.map(r => r.card_id)).size, 1326);
  const protectedIds = new Set(protectedRows.map(r => r.card_id));
  assert(mapping.assignments.every(r => !protectedIds.has(r.card_id)));
  const rules = mapping.media_rules.filter(r => r.decision === "A");
  const binders = [
    ...new Map(
      rules.map(r => [
        r.binder_id,
        {
          id: r.binder_id,
          series_media_id: r.series_media_id,
          display_name: r.display_name
        }
      ])
    ).values()
  ];
  const quote = v => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
  const chunks = (rows, statement) =>
    Array.from({ length: Math.ceil(rows.length / 500) }, (_, i) =>
      statement(quote(rows.slice(i * 500, i * 500 + 500)))
    ).join("\n");
  const knownBinders = new Set(binders.map(b => b.id));
  const aliasRows = [
    ...new Map(
      rules
        .flatMap(r => {
          const title = aliases.entries?.[r.media_id]?.media?.title ?? {};
          return [title.english, title.romaji]
            .filter(s => s?.trim() && s.length <= 500)
            .map(alias => ({ binder_id: r.binder_id, alias }));
        })
        .filter(r => knownBinders.has(r.binder_id))
        .map(r => [JSON.stringify(r), r])
    ).values()
  ];
  const sql =
    `-- PRIVATE catalogue proof; keep out of public Git and logs.\n-- Mapping SHA-256: ${digest}\nbegin;\nlock table public.anime_series_settings in exclusive mode;\ndo $$ begin if (select enabled from public.anime_series_settings where singleton) then raise exception 'BINDER_SEED_REQUIRES_DISABLED'; end if; if (select mapping_version from public.anime_series_settings where singleton) not in ('unloaded','${digest}') then raise exception 'BINDER_SEED_VERSION_CONFLICT'; end if; end $$;\n` +
    chunks(
      binders,
      j =>
        `insert into public.anime_series_binders select * from jsonb_populate_recordset(null::public.anime_series_binders,${j}) on conflict(id) do update set display_name=excluded.display_name;`
    ) +
    chunks(
      rules.map(r => ({
        media_id: r.media_id,
        binder_id: r.binder_id,
        decision: "A",
        editorial_approved: true
      })),
      j =>
        `insert into public.anime_series_media_rules select * from jsonb_populate_recordset(null::public.anime_series_media_rules,${j}) on conflict(media_id) do update set binder_id=excluded.binder_id,decision=excluded.decision,editorial_approved=excluded.editorial_approved;`
    ) +
    chunks(
      protectedRows.map(r => ({
        card_id: r.card_id,
        reason: r.exclusion_reason
      })),
      j =>
        `insert into public.anime_series_protected_cards select * from jsonb_populate_recordset(null::public.anime_series_protected_cards,${j}) on conflict(card_id) do nothing;`
    ) +
    chunks(
      aliasRows,
      j =>
        `insert into public.anime_series_aliases select * from jsonb_populate_recordset(null::public.anime_series_aliases,${j}) on conflict do nothing;`
    ) +
    chunks(
      mapping.assignments,
      j =>
        `insert into public.anime_series_origin_evidence(card_id,character_id,media_id,verified_snapshot,import_evidence_sha256)
select x.card_id,x.character_id,x.media_id,x.verified_snapshot,x.import_evidence_sha256
from jsonb_to_recordset(${j}) x(card_id uuid,source_license text,character_id integer,media_id integer,verified_snapshot jsonb,import_evidence_sha256 text)
join public.cards c on c.id=x.card_id
where (to_jsonb(c)-'favoris_count')=(x.verified_snapshot-'favoris_count')
and exists(select 1 from public.card_franchises l where l.card_id=c.id and l.franchise=x.source_license and l.position=0 and c.franchise=l.franchise)
and not exists(select 1 from public.anime_series_protected_cards p where p.card_id=c.id)
on conflict(card_id) do nothing;
insert into public.anime_series_card_assignments
select x.card_id,x.source_license,x.media_id
from jsonb_to_recordset(${j}) x(card_id uuid,source_license text,media_id integer,import_evidence_sha256 text)
join public.anime_series_origin_evidence e on e.card_id=x.card_id and e.media_id=x.media_id and e.import_evidence_sha256=x.import_evidence_sha256
join public.cards c on c.id=e.card_id
where (to_jsonb(c)-'favoris_count')=(e.verified_snapshot-'favoris_count')
and exists(select 1 from public.card_franchises l where l.card_id=c.id and l.franchise=x.source_license and l.position=0 and c.franchise=l.franchise)
on conflict(card_id,source_license) do nothing;`
    ) +
    `\nupdate public.anime_series_settings set mapping_version='${digest}',enabled=false where singleton;\ncommit;\n`;
  return {
    sql,
    summary: {
      mapping_sha256: digest,
      binders: binders.length,
      media_rules: rules.length,
      assignments: mapping.assignments.length,
      protected_cards: protectedIds.size,
      aliases: aliasRows.length,
      enabled: false
    }
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["mapping", "protected-cards", "aliases", "approval", "output"].map(k => [
        k,
        { type: "string" }
      ])
    )
  });
  for (const key of [
    "mapping",
    "protected-cards",
    "aliases",
    "approval",
    "output"
  ])
    assert(values[key], `Missing --${key}`);
  const read = p => JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  const digest = createHash("sha256")
    .update(readFileSync(values.mapping))
    .digest("hex");
  const result = prepareSeed(
    read(values.mapping),
    parse(readFileSync(values["protected-cards"], "utf8"), {
      columns: true,
      bom: true,
      delimiter: ";"
    }),
    read(values.aliases),
    read(values.approval),
    digest
  );
  writeFileSync(values.output, result.sql);
  writeFileSync(
    values.output + ".summary.json",
    JSON.stringify(result.summary, null, 2) + "\n"
  );
  console.log(JSON.stringify(result.summary));
}
