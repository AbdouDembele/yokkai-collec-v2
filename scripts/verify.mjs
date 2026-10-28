import { spawnSync, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function dockerWarning(result) {
  return result.error || result.status !== 0
    ? "AVERTISSEMENT : Docker indisponible. PostgreSQL 17 et concurrence NON EXECUTES."
    : null;
}

function main() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8"
  }).trim();
  const master = execFileSync("git", ["rev-parse", "origin/master"], {
    encoding: "utf8"
  }).trim();
  if (
    spawnSync("git", ["merge-base", "--is-ancestor", "origin/master", "HEAD"])
      .status !== 0
  )
    throw new Error(
      "Branche en retard sur origin/master : actualiser avant verify"
    );
  for (const args of [
    ["diff", "--quiet"],
    ["diff", "--cached", "--quiet"]
  ])
    if (spawnSync("git", args).status !== 0)
      throw new Error(
        "Commiter les changements suivis avant verify : le résultat doit identifier un commit exact"
      );
  console.log(`VERIFY commit ${head}\nBase origin/master ${master}`);
  const start = Date.now();
  const run = file =>
    spawnSync(process.execPath, [file], {
      stdio: "inherit",
      windowsHide: true,
      env: process.env
    });
  const checks = run("scripts/ci.mjs");
  if (checks.error || checks.status !== 0) {
    process.exitCode = checks.status || 1;
    console.error("VERIFY ECHEC : contrôles locaux");
    return;
  }
  const info = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000
  });
  const warning = dockerWarning(info);
  if (warning) console.warn(warning);
  else {
    const postgres = run("scripts/ci-db.mjs");
    if (postgres.error || postgres.status !== 0) {
      process.exitCode = postgres.status || 1;
      console.error("VERIFY ECHEC : PostgreSQL 17 / concurrence");
      return;
    }
  }
  console.log(
    `\nVERIFY OK${warning ? " AVEC AVERTISSEMENT DOCKER" : " — PostgreSQL 17 / concurrence OK"}\nCommit ${head}\nBase ${master}\nDurée ${((Date.now() - start) / 1000).toFixed(1)} s`
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
