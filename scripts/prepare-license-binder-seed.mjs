import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// Prepares private configuration only; never connects to any database.
export function prepareLicenseSeed(mapping, approval, mappingSha256) {
  assert.match(mappingSha256, /^[0-9a-f]{64}$/);
  assert.equal(approval.mapping_sha256, mappingSha256);
  assert.equal(approval.policy_approved, true);
  assert.equal(approval.manual_display_change_approved, true);
  assert.equal(approval.production_approved, false);
  assert.equal(mapping.version, 1);
  const sets = [
    ["anime_license_binders", mapping.binders],
    ["anime_license_source_rules", mapping.source_rules],
    ["anime_license_media_rules", mapping.media_rules],
    ["anime_license_aliases", mapping.aliases],
    ["anime_license_key_redirects", mapping.key_redirects]
  ];
  const statements = [
    "-- PRIVATE license configuration. Preserve the original V3 mapping and proofs.",
    "begin;",
    "lock table public.anime_series_settings in exclusive mode;",
    "do $$ begin if (select license_grouping_enabled or license_mapping_version<>'unloaded' from public.anime_series_settings where singleton) then raise exception 'LICENSE_MAPPING_ALREADY_LOADED'; end if; end $$;"
  ];
  for (const [table, rows] of sets) {
    assert(Array.isArray(rows) && rows.length <= 50000, table);
    const payload = JSON.stringify(rows);
    const tag =
      "$license_" +
      createHash("sha256").update(payload).digest("hex").slice(0, 16) +
      "$";
    assert(!payload.includes(tag));
    statements.push(
      `insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},${tag}${payload}${tag}::jsonb);`
    );
  }
  statements.push(
    `update public.anime_series_settings set license_mapping_version='${mappingSha256}' where singleton;`,
    "commit;"
  );
  return statements.join("\n") + "\n";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["mapping", "approval", "output"].map(key => [key, { type: "string" }])
    )
  });
  for (const key of ["mapping", "approval", "output"])
    assert(values[key], "Missing --" + key);
  const content = readFileSync(values.mapping);
  const digest = createHash("sha256").update(content).digest("hex");
  const sql = prepareLicenseSeed(
    JSON.parse(content),
    JSON.parse(readFileSync(values.approval, "utf8")),
    digest
  );
  writeFileSync(values.output, sql);
  console.log(
    JSON.stringify({
      status: "PREPARED_INACTIVE",
      mapping_sha256: digest,
      bytes: Buffer.byteLength(sql),
      production_modified: false
    })
  );
}
