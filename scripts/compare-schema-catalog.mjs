import { readFileSync } from "node:fs";
import { replayMigrations } from "./replay-migrations.mjs";
import { canonicalCheckConjunction } from "./check-constraint-canonical.mjs";

// Before deployment compare against the applied prefix, not the pending schema.
let db;
try {
  const selected = process.env.DRIFT_MIGRATIONS_JSON;
  const replay = await replayMigrations(
    selected === undefined ? {} : { migrations: JSON.parse(selected) }
  );
  db = replay.db;
  const { migrations } = replay;
  const expected = (
    await db.query(
      readFileSync(new URL("./schema-catalog.sql", import.meta.url), "utf8")
    )
  ).rows.map(row => JSON.parse(Object.values(row)[0]));
  const actual = readFileSync(process.argv[2], "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const key = row => `${row.kind}: ${row.name}`;
  if (
    actual.some(
      row =>
        !row ||
        typeof row.kind !== "string" ||
        typeof row.name !== "string" ||
        !Object.hasOwn(row, "value")
    ) ||
    new Set(actual.map(key)).size !== actual.length
  )
    throw new Error(
      "Invalid or duplicate production catalogue entries; drift check refused"
    );
  const canonical = value =>
    JSON.stringify(value, (_key, item) =>
      typeof item === "string"
        ? item.replace(/\r\n/g, "\n")
        : item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map(name => [name, item[name]])
            )
          : item
    );
  const comparable = row =>
    canonical(
      row.kind === "constraint" && row.value?.definition
        ? {
            ...row.value,
            definition: canonicalCheckConjunction(row.value.definition)
          }
        : row.value
    );
  const reference = new Map(expected.map(row => [key(row), comparable(row)]));
  const production = new Map(actual.map(row => [key(row), comparable(row)]));
  let differences = 0;
  for (const name of [
    ...new Set([...reference.keys(), ...production.keys()])
  ].sort()) {
    if (reference.get(name) === production.get(name)) continue;
    differences++;
    console.log(
      `${!reference.has(name) ? "PROD ONLY" : !production.has(name) ? "MISSING IN PROD" : "CHANGED"} ${name}`
    );
    console.log(`  migrations: ${reference.get(name) ?? "(absent)"}`);
    console.log(`  production: ${production.get(name) ?? "(absent)"}`);
  }
  console.log(
    `${migrations.length} migrations replayed; ${differences} divergences.`
  );
  process.exitCode = differences ? 1 : 0;
} catch (error) {
  console.error(`Catalogue comparison impossible: ${error.message}`);
  process.exitCode = 2;
} finally {
  await db?.close();
}
