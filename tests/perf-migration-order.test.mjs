import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { deploymentPlan } from "../scripts/plan-deploy-migrations.mjs";

test("pending migrations can follow the already-applied manual Pro access migration", () => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(directory)
    .filter(n => n.endsWith(".sql") && n.slice(0, 14) <= "20261019030002")
    .sort()
    .map(filename => ({
      filename,
      source: readFileSync(new URL(filename, directory), "utf8")
    }));
  const exceptions = JSON.parse(
    readFileSync(
      new URL(
        "../supabase/migration-registry-exceptions.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  // Production SELECT on 2026-10-19: PERF and admin English migrations are absent while
  // manual_pro_access (20261019000000) is already recorded. No live DB access.
  const pending = filename =>
    /_(perf_04_fk_indexes|pending_achievement_evaluation|english_admin_fallbacks)\.sql$/.test(
      filename
    );
  const registry = files
    .filter(
      f => f.filename.slice(0, 14) <= "20261019000000" && !pending(f.filename)
    )
    .map(({ filename }) => ({
      version: filename.slice(0, 14),
      name: exceptions[filename.slice(0, 14)]
        ? exceptions[filename.slice(0, 14)].name
        : filename.slice(15, -4)
    }));
  assert.deepEqual(deploymentPlan(files, registry).pending, [
    "20261019030000_perf_04_fk_indexes.sql",
    "20261019030001_pending_achievement_evaluation.sql",
    "20261019030002_english_admin_fallbacks.sql"
  ]);
});
