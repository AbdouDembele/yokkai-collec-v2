import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function needsPostgres17(
  paths,
  readSource = path => readFileSync(path, "utf8")
) {
  return paths.some(
    path =>
      path.startsWith("supabase/migrations/") ||
      path.startsWith("scripts/") ||
      // Client order that get_collection_groups_page must match on ICU (#388).
      [
        "lib/ui/collection-filter.ts",
        "lib/ui/collection-groups.ts",
        "lib/ui/collection-sort.ts",
        "lib/ui/card-search.ts"
      ].includes(path) ||
      (path.startsWith("tests/") &&
        (path.endsWith(".sql") ||
          path.endsWith("-db.test.mjs") ||
          /^tests\/postgres17-.*\.mjs$/.test(path) ||
          [
            "tests/migration-security.test.mjs",
            "tests/security-definer-allowlist.mjs",
            "tests/drop-rates-statistical.test.mjs"
          ].includes(path) ||
          (/\.mjs$/.test(path) &&
            /replayMigrations|bootstrapSQL|@electric-sql\/pglite/.test(
              readSource(path)
            ))))
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let sql = true; // Every push to master runs PostgreSQL 17, regardless of paths.
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    const { BASE_SHA, HEAD_SHA } = process.env;
    if (![BASE_SHA, HEAD_SHA].every(sha => /^[a-f0-9]{40}$/i.test(sha ?? "")))
      throw new Error("Missing valid PR commit SHAs; SQL filter cannot run");
    const paths = execFileSync(
      "git",
      ["diff", "--name-only", "-z", `${BASE_SHA}...${HEAD_SHA}`],
      { encoding: "utf8" }
    )
      .split("\0")
      .filter(Boolean);
    sql = needsPostgres17(paths, path => {
      const versions = [HEAD_SHA, BASE_SHA].flatMap(sha => {
        try {
          return [
            execFileSync("git", ["show", `${sha}:${path}`], {
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"]
            })
          ];
        } catch {
          return [];
        } // Added/deleted paths exist in only one snapshot.
      });
      if (!versions.length) throw new Error("Cannot inspect changed SQL test");
      return versions.join("\n");
    });
  }
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GITHUB_OUTPUT");
  appendFileSync(process.env.GITHUB_OUTPUT, `sql=${sql}\n`);
  console.log(`PostgreSQL 17 required: ${sql}`);
}
